import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

import { moneySchema, type Money } from "../../domain/money";

const SANDBOX_BASE_URL = "https://sandbox.api.prava.space";
const SANDBOX_COLLECT_ORIGIN = "https://sandbox.collect.prava.space";
const HOSTED_CHECKOUT_ORIGIN = "https://checkout.prava.space";
const SESSION_REFERENCE_PREFIX = "sandbox-v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
    timestamp: z.iso.datetime(),
  })
  .passthrough();

const sandboxApprovalUrlSchema = z
  .string()
  .url()
  .refine(
    (value) =>
      [SANDBOX_COLLECT_ORIGIN, HOSTED_CHECKOUT_ORIGIN].includes(
        new URL(value).origin,
      ),
    {
      message: "Sandbox approval URL must use a pinned Prava origin",
    },
  );

const createSessionResponseSchema = z
  .object({
    session_id: z.string().min(1),
    session_token: z.string().min(1),
    iframe_url: sandboxApprovalUrlSchema,
    order_id: z.string().min(1),
    expires_at: z.iso.datetime(),
  })
  .passthrough();

const paymentResultStatusSchema = z.enum([
  "pending",
  "processing",
  "awaiting_result",
  "completed",
  "failed",
]);

const paymentTransactionStatusSchema = z.enum([
  "pending",
  "awaiting_result",
  "completed",
  "failed",
]);

const paymentLineItemSchema = z
  .object({
    txn_ref_id: z.string().min(1),
    status: z.string().min(1),
    token: z.string().min(12).nullable(),
    dynamic_cvv: z.string().min(3).nullable(),
    expiry_month: z
      .string()
      .regex(/^\d{2}$/)
      .nullable(),
    expiry_year: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
  })
  .passthrough();

const paymentTransactionSchema = z
  .object({
    txn_id: z.string().min(1),
    status: paymentTransactionStatusSchema,
    line_items: z.array(paymentLineItemSchema),
  })
  .passthrough();

const paymentResultResponseSchema = z
  .object({
    session_id: z.string().min(1),
    order_id: z.string().nullable(),
    status: paymentResultStatusSchema,
    transactions: z.array(paymentTransactionSchema),
  })
  .passthrough();

const reportStatusInputSchema = z
  .object({
    txnRefId: z.string().min(1),
    txnStatus: z.enum(["APPROVED", "DECLINED"]),
    authorizationCode: z.string().max(128).optional(),
    responseCode: z.string().max(2).optional(),
    amountPaid: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .optional(),
  })
  .strict();

const reportStatusResponseSchema = z
  .object({
    status: z.literal("confirmed"),
    txn_ref_id: z.string().min(1),
    txn_status: z.enum(["APPROVED", "DECLINED"]),
    visa_confirmation: z.enum(["SUCCESS", "FAILURE"]),
  })
  .passthrough();

const revokeSessionResponseSchema = z
  .object({ success: z.literal(true) })
  .passthrough();

const sessionInputSchema = z
  .object({
    userId: z.string().min(1).max(255),
    userEmail: z.email(),
    total: moneySchema,
    merchant: z
      .object({
        name: z.string().min(1),
        url: z.url().refine((value) => new URL(value).protocol === "https:", {
          message: "Merchant URL must use HTTPS",
        }),
        countryCode: z.string().regex(/^[A-Z]{2}$/),
      })
      .strict(),
    product: z
      .object({
        description: z.string().min(1),
        productId: z.string().trim().min(1).max(50),
        unitPrice: moneySchema,
        quantity: z.number().int().positive(),
      })
      .strict(),
    externalOrderRef: z.string().min(1).max(255),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.total.currency !== "USD" ||
      input.product.unitPrice.currency !== "USD"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The current RelayBuy sandbox adapter supports USD minor units only",
      });
    } else if (input.total.currency !== input.product.unitPrice.currency) {
      context.addIssue({
        code: "custom",
        message: "Total and unit price currencies must match",
      });
    } else if (
      input.total.amountMinor !==
      input.product.unitPrice.amountMinor * input.product.quantity
    ) {
      context.addIssue({
        code: "custom",
        message: "Total must equal unit price multiplied by quantity",
      });
    }
  });

export type PravaSandboxSessionInput = z.infer<typeof sessionInputSchema>;
export type PravaSandboxPaymentStatus = z.infer<
  typeof paymentResultStatusSchema
>;
export type PravaSandboxReportInput = z.infer<typeof reportStatusInputSchema>;

export interface PravaEphemeralCredentials {
  dynamicCvv: string;
  expiryMonth: string;
  expiryYear: string;
  token: string;
}

export type PravaSandboxGatewayErrorCode =
  | "INVALID_SANDBOX_KEY"
  | "INVALID_SESSION_INPUT"
  | "UNKNOWN_SESSION_REFERENCE"
  | "VENDOR_REQUEST_FAILED"
  | "VENDOR_REQUEST_TIMEOUT"
  | "INVALID_VENDOR_RESPONSE";

export class PravaSandboxGatewayError extends Error {
  constructor(
    public readonly code: PravaSandboxGatewayErrorCode,
    message: string,
    public readonly details: {
      status?: number;
      responseId?: string;
      transportCode?: string;
      vendorCode?: string;
      startedAt?: string;
      finishedAt?: string;
    } = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PravaSandboxGatewayError";
  }
}

export interface PravaProviderResponseMeta {
  finishedAt: string;
  operation:
    | "create_session"
    | "health"
    | "payment_result"
    | "report_status"
    | "revoke_session";
  responseId: string | null;
  startedAt: string;
  status: number;
}

export type PravaSessionCreateFailureDisposition =
  | "known_rejection"
  | "unknown_outcome";

export function classifyPravaSessionCreateFailure(
  error: unknown,
): PravaSessionCreateFailureDisposition {
  if (!(error instanceof PravaSandboxGatewayError)) {
    return "unknown_outcome";
  }

  if (
    error.code === "INVALID_SANDBOX_KEY" ||
    error.code === "INVALID_SESSION_INPUT" ||
    (error.code === "VENDOR_REQUEST_FAILED" &&
      error.details.status !== undefined &&
      error.details.status >= 400 &&
      error.details.status < 500)
  ) {
    return "known_rejection";
  }

  return "unknown_outcome";
}

function transportErrorCode(error: unknown): string | undefined {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!candidate || typeof candidate !== "object") return undefined;
    if (
      "code" in candidate &&
      typeof candidate.code === "string" &&
      /^[A-Z0-9_]{2,100}$/.test(candidate.code)
    ) {
      return candidate.code;
    }
    candidate = "cause" in candidate ? candidate.cause : undefined;
  }
  return undefined;
}

type PravaSandboxGatewayOptions = {
  secretKey: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
};

function decimalAmount(money: Money): string {
  const whole = Math.floor(money.amountMinor / 100);
  const minor = String(money.amountMinor % 100).padStart(2, "0");
  return `${whole}.${minor}`;
}

export class PravaSandboxGateway {
  readonly #secretKey: string;
  readonly #fetch: typeof fetch;
  readonly #referenceKey: Buffer;
  readonly #requestTimeoutMs: number;
  #lastResponseMeta: PravaProviderResponseMeta | null = null;

  constructor(options: PravaSandboxGatewayOptions) {
    if (!options.secretKey.startsWith("sk_test_")) {
      throw new PravaSandboxGatewayError(
        "INVALID_SANDBOX_KEY",
        "The sandbox gateway accepts test keys only",
      );
    }

    const requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new PravaSandboxGatewayError(
        "INVALID_SESSION_INPUT",
        "The sandbox request timeout must be a positive integer",
      );
    }

    this.#secretKey = options.secretKey;
    this.#fetch = options.fetch ?? fetch;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#referenceKey = createHash("sha256")
      .update("relaybuy:prava:sandbox-session:v1\0")
      .update(options.secretKey)
      .digest();
  }

  get lastResponseMeta(): PravaProviderResponseMeta | null {
    return this.#lastResponseMeta;
  }

  async health(): Promise<{ status: "ok"; timestamp: string }> {
    const payload = await this.#request("/health", { method: "GET" }, "health");
    return this.#parseVendorResponse(healthResponseSchema, payload);
  }

  async createSession(input: PravaSandboxSessionInput): Promise<{
    mode: "sandbox";
    claim: "payment_mechanics_only";
    redactedSessionRef: string;
    approvalUrl: string;
    expiresAt: string;
    merchantOrderRef: null;
  }> {
    const parsedInput = sessionInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new PravaSandboxGatewayError(
        "INVALID_SESSION_INPUT",
        "The sandbox session input is invalid",
        {},
        { cause: parsedInput.error },
      );
    }

    const validInput = parsedInput.data;
    const payload = await this.#request(
      "/v1/sessions",
      {
        method: "POST",
        body: JSON.stringify({
          user_id: validInput.userId,
          user_email: validInput.userEmail,
          total_amount: decimalAmount(validInput.total),
          currency: validInput.total.currency,
          external_order_ref: validInput.externalOrderRef,
          description: validInput.product.description,
          purchase_context: [
            {
              merchant_details: {
                name: validInput.merchant.name,
                url: validInput.merchant.url,
                country_code_iso2: validInput.merchant.countryCode,
              },
              product_details: [
                {
                  description: validInput.product.description,
                  product_id: validInput.product.productId,
                  unit_price: decimalAmount(validInput.product.unitPrice),
                  quantity: validInput.product.quantity,
                },
              ],
              effective_until_minutes: 15,
            },
          ],
        }),
      },
      "create_session",
    );
    const session = this.#parseVendorResponse(
      createSessionResponseSchema,
      payload,
    );
    const redactedSessionRef = this.#sealSessionReference(session.session_id);

    return {
      mode: "sandbox",
      claim: "payment_mechanics_only",
      redactedSessionRef,
      approvalUrl: session.iframe_url,
      expiresAt: session.expires_at,
      merchantOrderRef: null,
    };
  }

  async getPaymentStatus(redactedSessionRef: string): Promise<{
    mode: "sandbox";
    claim: "payment_mechanics_only";
    redactedSessionRef: string;
    status: PravaSandboxPaymentStatus;
    merchantOrderRef: null;
  }> {
    const result = await this.getPaymentMaterial(redactedSessionRef);
    return {
      mode: result.mode,
      claim: result.claim,
      redactedSessionRef: result.redactedSessionRef,
      status: result.status,
      merchantOrderRef: null,
    };
  }

  async getPaymentMaterial(redactedSessionRef: string): Promise<{
    mode: "sandbox";
    claim: "payment_mechanics_only";
    redactedSessionRef: string;
    status: PravaSandboxPaymentStatus;
    txnRefId: string | null;
    credentials: PravaEphemeralCredentials | null;
  }> {
    const sessionId = this.#openSessionReference(redactedSessionRef);

    const payload = await this.#request(
      `/v1/sessions/${encodeURIComponent(sessionId)}/payment-result?_t=${Date.now()}`,
      { method: "GET" },
      "payment_result",
    );
    const result = this.#parseVendorResponse(
      paymentResultResponseSchema,
      payload,
    );
    if (result.session_id !== sessionId) {
      throw new PravaSandboxGatewayError(
        "INVALID_VENDOR_RESPONSE",
        "The Prava sandbox response session did not match the request",
      );
    }

    const readyLineItems = result.transactions.flatMap((transaction) =>
      transaction.line_items
        .filter((item) => item.status === "awaiting_result")
        .map((item) => ({ item, transactionStatus: transaction.status })),
    );
    const ready = readyLineItems.length === 1 ? readyLineItems[0] : undefined;
    const lineItem = ready?.item;
    const hasCredentials = Boolean(
      lineItem?.token &&
      lineItem.dynamic_cvv &&
      lineItem.expiry_month &&
      lineItem.expiry_year,
    );

    if (
      (result.status === "awaiting_result" &&
        (!lineItem ||
          ready?.transactionStatus !== "awaiting_result" ||
          !hasCredentials)) ||
      (result.status !== "awaiting_result" && readyLineItems.length > 0)
    ) {
      throw new PravaSandboxGatewayError(
        "INVALID_VENDOR_RESPONSE",
        "Prava returned ambiguous or incomplete payment material",
      );
    }

    return {
      mode: "sandbox",
      claim: "payment_mechanics_only",
      redactedSessionRef,
      status: result.status,
      txnRefId: lineItem?.txn_ref_id ?? null,
      credentials:
        lineItem && hasCredentials
          ? {
              dynamicCvv: lineItem.dynamic_cvv!,
              expiryMonth: lineItem.expiry_month!,
              expiryYear: lineItem.expiry_year!,
              token: lineItem.token!,
            }
          : null,
    };
  }

  async reportStatus(
    redactedSessionRef: string,
    input: PravaSandboxReportInput,
  ): Promise<{
    status: "confirmed";
    txnRefId: string;
    txnStatus: "APPROVED" | "DECLINED";
    visaConfirmation: "SUCCESS" | "FAILURE";
  }> {
    const sessionId = this.#openSessionReference(redactedSessionRef);
    const validInput = reportStatusInputSchema.parse(input);
    const payload = await this.#request(
      `/v1/sessions/${encodeURIComponent(sessionId)}/report-status`,
      {
        method: "POST",
        body: JSON.stringify({
          txn_ref_id: validInput.txnRefId,
          txn_status: validInput.txnStatus,
          txn_type: "PURCHASE",
          ...(validInput.authorizationCode
            ? { authorization_code: validInput.authorizationCode }
            : {}),
          ...(validInput.responseCode
            ? { response_code: validInput.responseCode }
            : {}),
          ...(validInput.amountPaid
            ? { amount_paid: validInput.amountPaid }
            : {}),
        }),
      },
      "report_status",
    );
    const result = this.#parseVendorResponse(
      reportStatusResponseSchema,
      payload,
    );
    if (
      result.txn_ref_id !== validInput.txnRefId ||
      result.txn_status !== validInput.txnStatus
    ) {
      throw new PravaSandboxGatewayError(
        "INVALID_VENDOR_RESPONSE",
        "The Prava report acknowledgement did not match the submitted outcome",
      );
    }
    return {
      status: result.status,
      txnRefId: result.txn_ref_id,
      txnStatus: result.txn_status,
      visaConfirmation: result.visa_confirmation,
    };
  }

  async revokeSession(redactedSessionRef: string): Promise<{ success: true }> {
    const sessionId = this.#openSessionReference(redactedSessionRef);
    const payload = await this.#request(
      `/v1/sessions/${encodeURIComponent(sessionId)}/revoke`,
      { method: "POST" },
      "revoke_session",
    );
    return this.#parseVendorResponse(revokeSessionResponseSchema, payload);
  }

  async #request(
    path: string,
    init: RequestInit,
    operation: PravaProviderResponseMeta["operation"],
  ): Promise<unknown> {
    let response: Response;
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.#requestTimeoutMs,
    );
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.#secretKey}`);
    if (init.body !== undefined) {
      headers.set("content-type", "application/json");
    }

    try {
      response = await this.#fetch(`${SANDBOX_BASE_URL}${path}`, {
        ...init,
        cache: "no-store",
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      const transportCode = transportErrorCode(error);
      if (controller.signal.aborted) {
        throw new PravaSandboxGatewayError(
          "VENDOR_REQUEST_TIMEOUT",
          "The Prava sandbox request timed out with an unknown remote outcome",
          {
            startedAt,
            finishedAt: new Date().toISOString(),
            ...(transportCode ? { transportCode } : {}),
          },
          { cause: error },
        );
      }

      throw new PravaSandboxGatewayError(
        "VENDOR_REQUEST_FAILED",
        "The Prava sandbox request could not be completed",
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          ...(transportCode ? { transportCode } : {}),
        },
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }

    const finishedAt = new Date().toISOString();
    const responseId = response.headers.get("x-response-id");
    this.#lastResponseMeta = {
      finishedAt,
      operation,
      responseId,
      startedAt,
      status: response.status,
    };

    if (!response.ok) {
      const vendorPayload = await response
        .clone()
        .json()
        .catch(() => undefined);
      const vendorCode = z
        .object({
          error: z.object({ code: z.string().min(1) }).passthrough(),
        })
        .passthrough()
        .safeParse(vendorPayload);

      throw new PravaSandboxGatewayError(
        "VENDOR_REQUEST_FAILED",
        `The Prava sandbox request failed with status ${response.status}`,
        {
          status: response.status,
          ...(responseId ? { responseId } : {}),
          startedAt,
          finishedAt,
          ...(vendorCode.success
            ? { vendorCode: vendorCode.data.error.code }
            : {}),
        },
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new PravaSandboxGatewayError(
        "INVALID_VENDOR_RESPONSE",
        "The Prava sandbox response was not valid JSON",
        response.headers.has("x-response-id")
          ? {
              responseId: response.headers.get("x-response-id")!,
            }
          : {},
        { cause: error },
      );
    }
  }

  #parseVendorResponse<TSchema extends z.ZodType>(
    schema: TSchema,
    payload: unknown,
  ): z.output<TSchema> {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new PravaSandboxGatewayError(
        "INVALID_VENDOR_RESPONSE",
        "The Prava sandbox response did not match the pinned contract",
        {},
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  #sealSessionReference(sessionId: string): string {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.#referenceKey,
      initializationVector,
    );
    const encrypted = Buffer.concat([
      cipher.update(sessionId, "utf8"),
      cipher.final(),
    ]);
    const authenticationTag = cipher.getAuthTag();

    return [
      SESSION_REFERENCE_PREFIX,
      initializationVector.toString("base64url"),
      encrypted.toString("base64url"),
      authenticationTag.toString("base64url"),
    ].join(".");
  }

  #openSessionReference(reference: string): string {
    try {
      const [prefix, initializationVector, encrypted, authenticationTag] =
        reference.split(".");

      if (
        prefix !== SESSION_REFERENCE_PREFIX ||
        !initializationVector ||
        !encrypted ||
        !authenticationTag
      ) {
        throw new Error("Malformed session reference");
      }

      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#referenceKey,
        Buffer.from(initializationVector, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(authenticationTag, "base64url"));
      const sessionId = Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64url")),
        decipher.final(),
      ]).toString("utf8");

      if (!sessionId) {
        throw new Error("Empty session reference");
      }

      return sessionId;
    } catch (error) {
      throw new PravaSandboxGatewayError(
        "UNKNOWN_SESSION_REFERENCE",
        "The redacted sandbox session reference is invalid or belongs to another environment",
        {},
        { cause: error },
      );
    }
  }
}
