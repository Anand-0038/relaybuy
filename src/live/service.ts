import "server-only";

import { ZodError, z } from "zod";

import {
  parseRuntimeConfig,
  RuntimeConfigurationError,
} from "@/config/runtime";
import { evaluatePaymentGate } from "@/domain/payment-gate";
import {
  classifyPravaSessionCreateFailure,
  PravaSandboxGateway,
  PravaSandboxGatewayError,
} from "@/integrations/prava/sandbox-gateway";
import {
  RequestSecurityError,
  privateResponseHeaders,
} from "@/server/request-security";

import {
  assertApprovalStillCurrent,
  createApprovalArtifact,
  hashApprovalArtifact,
  hashApprovalToken,
  issueApprovalToken,
  issueRequestToken,
} from "./artifact";
import { getLiveEnvironment } from "./env";
import {
  attemptBonesCoffeeCheckout,
  BonesCoffeeCheckoutError,
  inspectBonesCoffeeOffer,
} from "./merchant/bones-coffee";
import {
  extractPurchaseIntent,
  LiveOpenAiExtractionError,
} from "./openai-extractor";
import {
  createMerchantAttemptDigest,
  createOutcomeReportIdempotencyKey,
  createSessionIdempotencyKey,
} from "./operations";
import { evaluateLivePurchasePolicy } from "./policy";
import { LiveRepositoryError, LiveRequestRepository } from "./repository";
import { resolvePurchaseEvidence } from "./senso";
import {
  createLiveRequestInputSchema,
  type CreateLiveRequestInput,
  type LiveRequestSnapshot,
} from "./types";

const requestIdSchema = z.uuid();
const approvalTokenSchema = z.string().min(32).max(256);
const requestTokenSchema = z.string().regex(/^rb_req_[A-Za-z0-9_-]{43}$/);
const repository = new LiveRequestRepository();
const merchantExecutions = new Map<string, Promise<LiveRequestSnapshot>>();

function isPravaTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed";
}

function getPravaGateway(): PravaSandboxGateway {
  const runtime = parseRuntimeConfig(process.env);
  if (runtime.mode === "live") {
    throw new LiveRepositoryError(
      "CONFLICT",
      "Live MCP execution is intentionally blocked until support@prava.space confirms the authoritative contract and explicit live checkout sequence are provided.",
    );
  }
  if (runtime.mode !== "sandbox") {
    throw new LiveRepositoryError(
      "CONFLICT",
      "The live control plane requires explicit Prava sandbox mode",
    );
  }
  return new PravaSandboxGateway({
    secretKey: getLiveEnvironment().PRAVA_MERCHANT_SECRET_KEY,
  });
}

export async function createLiveRequest(
  input: CreateLiveRequestInput,
): Promise<{
  request: LiveRequestSnapshot;
  requestCapability: string;
}> {
  const parsed = createLiveRequestInputSchema.parse(input);
  const environment = getLiveEnvironment();
  const requestCapability = issueRequestToken();
  const request = await repository.create({
    expiresAt: new Date(
      Date.now() + environment.LIVE_REQUEST_TTL_MINUTES * 60_000,
    ),
    requestText: parsed.requestText,
    requestTokenHash: hashApprovalToken(
      requestCapability,
      environment.APPROVAL_TOKEN_PEPPER,
    ),
    source: parsed.source,
  });
  return { request, requestCapability };
}

export async function authorizeLiveRequestCapability(
  requestId: string,
  token: string,
): Promise<LiveRequestSnapshot> {
  const id = requestIdSchema.safeParse(requestId);
  const parsed = requestTokenSchema.safeParse(token);
  if (!id.success || !parsed.success) {
    throw new LiveRepositoryError(
      "UNAUTHORIZED",
      "A valid request capability is required",
    );
  }
  const { APPROVAL_TOKEN_PEPPER } = getLiveEnvironment();
  const request = await repository.getByRequestTokenHash(
    hashApprovalToken(parsed.data, APPROVAL_TOKEN_PEPPER),
  );
  if (request.id !== id.data) {
    throw new LiveRepositoryError("NOT_FOUND", "Purchase request not found");
  }
  return request;
}

export async function authorizeLiveApprovalCapability(
  requestId: string,
  token: string,
): Promise<LiveRequestSnapshot> {
  const id = requestIdSchema.safeParse(requestId);
  const parsed = approvalTokenSchema.safeParse(token);
  if (!id.success || !parsed.success) {
    throw new LiveRepositoryError(
      "UNAUTHORIZED",
      "A valid approval capability is required",
    );
  }
  const { APPROVAL_TOKEN_PEPPER } = getLiveEnvironment();
  const request = await repository.getByApprovalTokenHash(
    hashApprovalToken(parsed.data, APPROVAL_TOKEN_PEPPER),
  );
  if (request.id !== id.data || !request.approval?.approvedAt) {
    throw new LiveRepositoryError("NOT_FOUND", "Purchase request not found");
  }
  return request;
}

export async function getLiveRequest(
  requestId: string,
): Promise<LiveRequestSnapshot> {
  return repository.getById(requestIdSchema.parse(requestId));
}

export async function extractLiveRequest(
  requestId: string,
): Promise<LiveRequestSnapshot> {
  const id = requestIdSchema.parse(requestId);
  const request = await repository.getById(id);
  const extraction = await extractPurchaseIntent(request.requestText);
  return repository.saveExtraction({
    intent: extraction.intent,
    model: extraction.model,
    requestId: id,
  });
}

export async function resolveLiveRequestEvidence(
  requestId: string,
): Promise<LiveRequestSnapshot> {
  const id = requestIdSchema.parse(requestId);
  const request = await repository.getById(id);
  if (!request.intent) {
    throw new LiveRepositoryError(
      "CONFLICT",
      "Extraction must complete before evidence resolution",
    );
  }
  const offer = await inspectBonesCoffeeOffer();
  const evidence = await resolvePurchaseEvidence(request.intent, offer);
  return repository.saveEvidence({ evidence, offer, requestId: id });
}

export async function evaluateLiveRequest(
  requestId: string,
): Promise<LiveRequestSnapshot> {
  const id = requestIdSchema.parse(requestId);
  const request = await repository.getById(id);
  if (!request.intent || !request.offer || !request.evidence) {
    throw new LiveRepositoryError(
      "CONFLICT",
      "Intent and evidence are required before policy evaluation",
    );
  }
  return repository.savePolicyDecision({
    decision: evaluateLivePurchasePolicy(
      request.intent,
      request.offer,
      request.evidence,
      {
        minimumEvidenceScore: getLiveEnvironment().SENSO_MIN_SCORE,
      },
    ),
    requestId: id,
  });
}

export async function issueLiveRequestApproval(requestId: string): Promise<{
  approvalUrl: string;
  request: LiveRequestSnapshot;
}> {
  const id = requestIdSchema.parse(requestId);
  const current = await repository.getById(id);
  const artifact = createApprovalArtifact(current);
  const artifactHash = hashApprovalArtifact(artifact);
  const token = issueApprovalToken();
  const environment = getLiveEnvironment();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const request = await repository.issueApproval({
    artifact,
    artifactHash,
    expiresAt,
    requestId: id,
    tokenHash: hashApprovalToken(token, environment.APPROVAL_TOKEN_PEPPER),
  });
  return {
    approvalUrl: new URL(
      `/live/approve/${token}`,
      environment.APP_BASE_URL,
    ).toString(),
    request,
  };
}

export async function previewLiveApproval(
  token: string,
): Promise<LiveRequestSnapshot> {
  const parsed = approvalTokenSchema.parse(token);
  const { APPROVAL_TOKEN_PEPPER } = getLiveEnvironment();
  return repository.getByApprovalTokenHash(
    hashApprovalToken(parsed, APPROVAL_TOKEN_PEPPER),
  );
}

export async function consumeLiveApproval(
  token: string,
): Promise<LiveRequestSnapshot> {
  const parsed = approvalTokenSchema.parse(token);
  const { APPROVAL_TOKEN_PEPPER } = getLiveEnvironment();
  const tokenHash = hashApprovalToken(parsed, APPROVAL_TOKEN_PEPPER);
  const current = await repository.getByApprovalTokenHash(tokenHash);
  if (!current.approval || !current.evidence) {
    throw new LiveRepositoryError(
      "CONFLICT",
      "The approval artifact is incomplete",
    );
  }
  try {
    assertApprovalStillCurrent(
      current.approval.artifact,
      await inspectBonesCoffeeOffer(),
      current.evidence,
    );
  } catch (error) {
    await repository.invalidateApproval(
      current.id,
      error instanceof Error ? error.message : "APPROVAL_INVALIDATED",
    );
    throw new LiveRepositoryError(
      "EXPIRED",
      "The merchant offer or policy evidence changed; request a new approval",
    );
  }
  return repository.consumeApproval(tokenHash);
}

export async function createLivePravaSession(
  requestId: string,
): Promise<LiveRequestSnapshot> {
  const id = requestIdSchema.parse(requestId);
  let current = await repository.getById(id);
  if (current.prava) {
    return current;
  }
  const merchantUrl = current.approval?.artifact.merchantUrl ?? null;
  if (
    current.state !== "approved" ||
    !current.approval?.approvedAt ||
    !current.evidence ||
    !merchantUrl
  ) {
    throw new LiveRepositoryError(
      "CONFLICT",
      "An approved artifact with current evidence is required",
    );
  }

  try {
    assertApprovalStillCurrent(
      current.approval.artifact,
      await inspectBonesCoffeeOffer(),
      current.evidence,
    );
  } catch (error) {
    await repository.invalidateApproval(
      current.id,
      error instanceof Error ? error.message : "APPROVAL_INVALIDATED",
    );
    throw new LiveRepositoryError(
      "CONFLICT",
      "The approved merchant payload changed and must be approved again",
    );
  }

  const currentArtifact = createApprovalArtifact(current);
  const currentArtifactHash = hashApprovalArtifact(currentArtifact);
  const idempotencyKey = createSessionIdempotencyKey(
    current.approval.artifactHash,
  );
  const runtime = parseRuntimeConfig(process.env);
  const gate = evaluatePaymentGate({
    approvalStatus:
      current.approval.approvedAt &&
      new Date(current.approval.expiresAt) > new Date()
        ? "current"
        : "expired",
    approvedPayloadHash: current.approval.artifactHash,
    budgetDecision:
      current.policyDecision?.status === "pass" ? "approved" : "blocked",
    currentPayloadHash: currentArtifactHash,
    idempotencyKey,
    liveOrderEnabled: runtime.liveOrderEnabled,
    mode: runtime.mode,
    paymentsEnabled: runtime.paymentsEnabled,
    quoteStatus:
      new Date(current.approval.artifact.quoteExpiresAt) > new Date()
        ? "fresh"
        : "expired",
    sessionCreationEnabled: runtime.sessionCreationEnabled,
    variantDecision:
      current.policyDecision?.status === "pass" ? "approved" : "rejected",
  });
  if (gate.status === "rejected") {
    throw new LiveRepositoryError(
      "CONFLICT",
      `Payment gate rejected session creation: ${gate.reason}`,
    );
  }
  const gateway = getPravaGateway();

  current = await repository.claimPravaSessionOperation({
    artifactHash: current.approval.artifactHash,
    idempotencyKey: gate.idempotencyKey,
    requestId: id,
  });
  if (current.prava) {
    return current;
  }

  const artifact = current.approval!.artifact;
  const environment = getLiveEnvironment();
  try {
    const session = await gateway.createSession({
      externalOrderRef: gate.idempotencyKey,
      merchant: {
        countryCode: environment.PRAVA_MERCHANT_COUNTRY,
        name: artifact.merchantName,
        url: merchantUrl,
      },
      product: {
        description: `${artifact.productName} ${artifact.quotedColor} ${artifact.quotedSize} (${artifact.sku})`,
        productId: artifact.sku,
        quantity: artifact.quantity,
        unitPrice: {
          amountMinor: artifact.unitPriceMinor,
          currency: artifact.currency,
        },
      },
      total: {
        amountMinor: artifact.quoteTotalMinor,
        currency: artifact.currency,
      },
      userEmail: environment.PRAVA_USER_EMAIL,
      userId: environment.PRAVA_USER_ID,
    });
    const now = new Date().toISOString();
    return repository.savePravaSession({
      prava: {
        approvalUrl: session.approvalUrl,
        claim: session.claim,
        createdAt: now,
        credentialsReady: false,
        expiresAt: session.expiresAt,
        mode: session.mode,
        redactedSessionRef: session.redactedSessionRef,
        status: "pending",
        txnRefId: null,
        updatedAt: now,
      },
      requestId: id,
    });
  } catch (error) {
    if (classifyPravaSessionCreateFailure(error) === "known_rejection") {
      const gatewayError =
        error instanceof PravaSandboxGatewayError ? error : null;
      await repository.markPravaSessionOperationFailed({
        requestId: id,
        ...(gatewayError?.details.status === undefined
          ? {}
          : { status: gatewayError.details.status }),
        ...(gatewayError?.details.vendorCode === undefined
          ? {}
          : { vendorCode: gatewayError.details.vendorCode }),
      });
      throw new LiveRepositoryError(
        "CONFLICT",
        gatewayError?.details.status
          ? `Prava rejected sandbox session creation (HTTP ${gatewayError.details.status}${gatewayError.details.vendorCode ? `, ${gatewayError.details.vendorCode}` : ""}); no session was created and the same approved operation may be retried.`
          : "Prava session creation was rejected before any vendor request; no session was created.",
      );
    }

    await repository
      .markPravaSessionOperationUnknown(id)
      .catch(() => undefined);
    throw new LiveRepositoryError(
      "CONFLICT",
      "Prava session creation has an unknown remote outcome. RelayBuy will not retry until the operation is reconciled.",
    );
  }
}

export async function reconcileLivePravaSession(
  requestId: string,
): Promise<LiveRequestSnapshot> {
  const id = requestIdSchema.parse(requestId);
  const current = await repository.getById(id);
  if (!current.prava) {
    throw new LiveRepositoryError(
      "CONFLICT",
      "Create the Prava session before reconciliation",
    );
  }
  if (
    ["prava_pending", "credentials_issued"].includes(current.state) &&
    new Date(current.prava.expiresAt) <= new Date()
  ) {
    return repository.savePravaReconciliation({
      event: "prava_session_failed",
      prava: {
        ...current.prava,
        credentialsReady: false,
        status: "failed",
        updatedAt: new Date().toISOString(),
      },
      requestId: id,
    });
  }
  const result = await getPravaGateway().getPaymentMaterial(
    current.prava.redactedSessionRef,
  );
  const credentialsReady = result.credentials !== null;
  const event =
    result.status === "awaiting_result" && current.state === "prava_pending"
      ? "prava_credentials_issued"
      : result.status === "failed" &&
          ["prava_pending", "credentials_issued"].includes(current.state)
        ? "prava_session_failed"
        : result.status === "completed" &&
            ["prava_pending", "credentials_issued"].includes(current.state)
          ? "prava_terminal_observed"
          : null;
  return repository.savePravaReconciliation({
    event,
    prava: {
      ...current.prava,
      credentialsReady,
      status: result.status,
      txnRefId: result.txnRefId,
      updatedAt: new Date().toISOString(),
    },
    requestId: id,
  });
}

async function reportMerchantDecline(
  current: LiveRequestSnapshot,
): Promise<LiveRequestSnapshot> {
  const merchantAttempt = current.prava?.merchantAttempt;
  const txnRefId = current.prava?.txnRefId;
  if (!current.prava || !merchantAttempt || !txnRefId) {
    throw new LiveRepositoryError(
      "CONFLICT",
      "A persisted merchant decline is required before outcome reporting",
    );
  }
  const merchantAttemptDigest = createMerchantAttemptDigest(merchantAttempt);
  const idempotencyKey = createOutcomeReportIdempotencyKey(
    txnRefId,
    merchantAttemptDigest,
  );
  current = await repository.beginOutcomeReport({
    idempotencyKey,
    merchantAttemptDigest,
    requestId: current.id,
    txnRefId,
  });

  let gateway: PravaSandboxGateway;
  try {
    gateway = getPravaGateway();
    const report = await gateway.reportStatus(
      current.prava!.redactedSessionRef,
      {
        txnRefId,
        txnStatus: "DECLINED",
      },
    );
    if (report.visaConfirmation !== "SUCCESS") {
      throw new LiveRepositoryError(
        "CONFLICT",
        "Prava did not confirm the reported merchant outcome",
      );
    }
  } catch {
    throw new LiveRepositoryError(
      "CONFLICT",
      "Prava outcome reporting has an unknown remote outcome. The durable report operation must be reconciled before any retry.",
    );
  }

  const acknowledgedAt = new Date().toISOString();
  current = await repository.completeOutcomeReport({
    prava: {
      ...current.prava!,
      credentialsReady: false,
      report: {
        acknowledgedAt,
        txnStatus: "DECLINED",
        visaConfirmation: "SUCCESS",
      },
      reportOperation: {
        idempotencyKey,
        status: "reported",
        updatedAt: acknowledgedAt,
      },
      updatedAt: acknowledgedAt,
    },
    requestId: current.id,
  });

  let finalPayment: Awaited<
    ReturnType<PravaSandboxGateway["getPaymentMaterial"]>
  >;
  try {
    finalPayment = await gateway.getPaymentMaterial(
      current.prava!.redactedSessionRef,
    );
  } catch {
    console.warn(
      "Prava terminal status poll deferred after acknowledged outcome report",
      { requestId: current.publicId },
    );
    return current;
  }

  const reconciledAt = new Date().toISOString();
  return repository.savePravaReconciliation({
    event: null,
    prava: {
      ...current.prava!,
      credentialsReady: false,
      status: finalPayment.status,
      updatedAt: reconciledAt,
    },
    requestId: current.id,
  });
}

export async function executeLiveMerchantCheckout(
  requestId: string,
): Promise<LiveRequestSnapshot> {
  const id = requestIdSchema.parse(requestId);
  const inFlight = merchantExecutions.get(id);
  if (inFlight) {
    return inFlight;
  }

  const execution = (async () => {
    let current = await repository.getById(id);
    if (current.state === "reported") {
      return current;
    }
    if (current.state === "merchant_declined_test_card") {
      return reportMerchantDecline(current);
    }
    if (current.state === "report_failed" && current.prava) {
      const observed = await getPravaGateway().getPaymentMaterial(
        current.prava.redactedSessionRef,
      );
      if (isPravaTerminalStatus(observed.status)) {
        return repository.savePravaReconciliation({
          event: "prava_terminal_observed",
          prava: {
            ...current.prava,
            credentialsReady: false,
            status: observed.status,
            updatedAt: new Date().toISOString(),
          },
          requestId: id,
        });
      }
      throw new LiveRepositoryError(
        "CONFLICT",
        "The prior outcome report is not terminal and must be reconciled; RelayBuy will not retry it.",
      );
    }
    if (current.state === "reporting_outcome" && current.prava) {
      const observed = await getPravaGateway().getPaymentMaterial(
        current.prava.redactedSessionRef,
      );
      if (isPravaTerminalStatus(observed.status)) {
        return repository.savePravaReconciliation({
          event: "prava_terminal_observed",
          prava: {
            ...current.prava,
            credentialsReady: false,
            status: observed.status,
            updatedAt: new Date().toISOString(),
          },
          requestId: id,
        });
      }
      throw new LiveRepositoryError(
        "CONFLICT",
        "The previous report acknowledgement has an unknown remote outcome and must be reconciled; RelayBuy will not retry it.",
      );
    }
    if (current.state === "merchant_checkout_running" && current.prava) {
      await repository.savePravaReconciliation({
        event: "credential_window_lost",
        prava: {
          ...current.prava,
          credentialsReady: false,
          updatedAt: new Date().toISOString(),
        },
        requestId: id,
      });
      throw new LiveRepositoryError(
        "CONFLICT",
        "The prior credential execution window was lost; manual review is required",
      );
    }
    if (
      !current.prava ||
      !current.approval ||
      current.state !== "credentials_issued" ||
      !current.prava.credentialsReady ||
      !current.prava.txnRefId
    ) {
      throw new LiveRepositoryError(
        "CONFLICT",
        "Prava credentials must be issued before merchant execution",
      );
    }
    if (new Date(current.prava.expiresAt) <= new Date()) {
      await repository.savePravaReconciliation({
        event: "prava_session_failed",
        prava: {
          ...current.prava,
          credentialsReady: false,
          status: "failed",
          updatedAt: new Date().toISOString(),
        },
        requestId: id,
      });
      throw new LiveRepositoryError(
        "EXPIRED",
        "The Prava credential session expired before merchant execution",
      );
    }

    const gateway = getPravaGateway();
    const payment = await gateway.getPaymentMaterial(
      current.prava.redactedSessionRef,
    );
    if (
      payment.status !== "awaiting_result" ||
      !payment.credentials ||
      payment.txnRefId !== current.prava.txnRefId
    ) {
      throw new LiveRepositoryError(
        "CONFLICT",
        "The Prava credential state changed before merchant execution",
      );
    }

    current = await repository.savePravaReconciliation({
      event: "merchant_checkout_started",
      prava: {
        ...current.prava,
        updatedAt: new Date().toISOString(),
      },
      requestId: id,
    });

    try {
      const merchantAttempt = await attemptBonesCoffeeCheckout({
        artifact: current.approval!.artifact,
        credentials: payment.credentials,
      });
      current = await repository.savePravaReconciliation({
        event: "merchant_checkout_declined",
        prava: {
          ...current.prava!,
          merchantAttempt,
          updatedAt: new Date().toISOString(),
        },
        requestId: id,
      });
      return reportMerchantDecline(current);
    } catch (error) {
      if (current.prava && current.state === "merchant_checkout_running") {
        await repository
          .savePravaReconciliation({
            event: "merchant_checkout_blocked",
            prava: {
              ...current.prava,
              credentialsReady: false,
              updatedAt: new Date().toISOString(),
            },
            requestId: id,
          })
          .catch(() => undefined);
      }
      if (error instanceof BonesCoffeeCheckoutError) {
        throw new LiveRepositoryError(
          "CONFLICT",
          `Merchant checkout blocked safely: ${error.code}`,
        );
      }
      throw error;
    }
  })().finally(() => {
    merchantExecutions.delete(id);
  });
  merchantExecutions.set(id, execution);
  return execution;
}

export function liveRouteError(error: unknown): Response {
  if (error instanceof RequestSecurityError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { headers: privateResponseHeaders, status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "The request did not match the required schema.",
        },
      },
      { headers: privateResponseHeaders, status: 400 },
    );
  }
  if (error instanceof LiveOpenAiExtractionError) {
    const status = error.code === "OPENAI_CAPACITY_UNAVAILABLE" ? 429 : 503;
    const messages: Record<LiveOpenAiExtractionError["code"], string> = {
      OPENAI_AUTH_FAILED:
        "OpenAI authentication is unavailable; verify the server-side API key.",
      OPENAI_CAPACITY_UNAVAILABLE:
        "OpenAI quota or rate capacity is unavailable; no fallback extraction was fabricated.",
      OPENAI_EXTRACTION_FAILED:
        "OpenAI did not return a valid typed extraction; the workflow stopped safely.",
      OPENAI_MODEL_UNAVAILABLE:
        "The configured OpenAI extraction models are unavailable.",
      OPENAI_UNAVAILABLE:
        "OpenAI is temporarily unavailable; the workflow stopped before evidence or payment.",
    };
    return Response.json(
      { error: { code: error.code, message: messages[error.code] } },
      { headers: privateResponseHeaders, status },
    );
  }
  if (error instanceof LiveRepositoryError) {
    const status =
      error.code === "UNAUTHORIZED"
        ? 401
        : error.code === "NOT_FOUND"
          ? 404
          : error.code === "EXPIRED" || error.code === "TOKEN_USED"
            ? 410
            : 409;
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { headers: privateResponseHeaders, status },
    );
  }
  if (error instanceof RuntimeConfigurationError) {
    const status =
      error.code === "INVALID_MODE" || error.code === "INVALID_FLAGS"
        ? 400
        : 409;
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { headers: privateResponseHeaders, status },
    );
  }

  console.error("Live workflow error", {
    message: error instanceof Error ? error.message : "Unknown error",
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return Response.json(
    {
      error: {
        code: "LIVE_WORKFLOW_FAILED",
        message:
          "The live workflow failed closed. No approval or payment action was taken.",
      },
    },
    { headers: privateResponseHeaders, status: 502 },
  );
}
