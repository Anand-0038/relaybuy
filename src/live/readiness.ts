import "server-only";

import { parseRuntimeConfig } from "@/config/runtime";

import { getLiveSql } from "./db";
import { getLiveEnvironment } from "./env";
import { inspectBonesCoffeeOffer } from "./merchant/bones-coffee";
import {
  extractPurchaseIntent,
  LiveOpenAiExtractionError,
} from "./openai-extractor";
import { evaluateLivePurchasePolicy } from "./policy";
import { resolvePurchaseEvidence } from "./senso";
import type {
  EvidenceBundle,
  PurchaseIntent,
  VerifiedMerchantOffer,
} from "./types";

export const canonicalReadinessRequest = [
  'Buy quantity 1 of the product "Bones Coffee Company Gift Card".',
  'Use preferred merchant "Bones Coffee Company".',
  'The requested primary variant option is "$10.00".',
  'The requested secondary type is "E-gift card".',
  "The budget is at most $10.00 USD and the merchant must be approved.",
].join(" ");

type ReadinessCheck = { status: "ready" } | { code: string; status: "blocked" };

export interface ConnectedReadinessResult {
  checkedAt: string;
  checks: {
    database: ReadinessCheck;
    merchant: ReadinessCheck;
    openai: ReadinessCheck;
    paymentSafety: ReadinessCheck;
    policy: ReadinessCheck;
    pravaAuthentication: ReadinessCheck;
    senso: ReadinessCheck;
  };
  status: "blocked" | "ready";
}

export interface ConnectedReadinessDependencies {
  extractIntent: (
    requestText: string,
  ) => Promise<{ intent: PurchaseIntent; model: string }>;
  inspectOffer: () => Promise<VerifiedMerchantOffer>;
  minimumEvidenceScore: number;
  now: () => Date;
  probeDatabase: () => Promise<boolean>;
  probePaymentSafety: () => boolean;
  probePravaAuthentication: () => Promise<boolean>;
  resolveEvidence: (
    intent: PurchaseIntent,
    offer: VerifiedMerchantOffer,
  ) => Promise<EvidenceBundle>;
}

async function probeDatabase(): Promise<boolean> {
  const rows = await getLiveSql()<Array<{ ok: number }>>`SELECT 1 AS ok`;
  return rows[0]?.ok === 1;
}

async function probePravaAuthentication(): Promise<boolean> {
  const { PRAVA_MERCHANT_SECRET_KEY } = getLiveEnvironment();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(
        "https://sandbox.api.prava.space/v1/sessions",
        {
          body: "{}",
          headers: {
            Authorization: `Bearer ${PRAVA_MERCHANT_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (response.status === 400) {
        const payload = (await response.json()) as {
          error?: { code?: unknown };
        };
        if (payload.error?.code === "VAL_2001") return true;
        console.warn("Prava readiness returned an unexpected validation code");
        return false;
      }
      if (response.status !== 429 && response.status < 500) {
        console.warn(`Prava readiness returned HTTP ${response.status}`);
        return false;
      }
      console.warn(`Prava readiness returned HTTP ${response.status}`);
    } catch (error) {
      console.warn(
        `Prava readiness transport failed: ${error instanceof Error ? error.name : "UnknownError"}`,
      );
      // The deliberately invalid payload cannot create a session; one retry is safe.
    }
  }
  return false;
}

async function inspectOfferWithRetry(): Promise<VerifiedMerchantOffer> {
  try {
    return await inspectBonesCoffeeOffer();
  } catch {
    return inspectBonesCoffeeOffer();
  }
}

const defaultDependencies: ConnectedReadinessDependencies = {
  extractIntent: extractPurchaseIntent,
  inspectOffer: inspectOfferWithRetry,
  get minimumEvidenceScore() {
    return getLiveEnvironment().SENSO_MIN_SCORE;
  },
  now: () => new Date(),
  probeDatabase,
  probePaymentSafety: () => {
    const runtime = parseRuntimeConfig(process.env);
    return (
      runtime.mode === "replay" &&
      !runtime.liveOrderEnabled &&
      !runtime.paymentsEnabled &&
      !runtime.sessionCreationEnabled
    );
  },
  probePravaAuthentication,
  resolveEvidence: resolvePurchaseEvidence,
};

function blocked(code: string): ReadinessCheck {
  return { code, status: "blocked" };
}

function settledBoolean(
  result: PromiseSettledResult<boolean>,
  code: string,
): ReadinessCheck {
  return result.status === "fulfilled" && result.value
    ? { status: "ready" }
    : blocked(code);
}

export async function probeConnectedReadiness(
  dependencies: ConnectedReadinessDependencies = defaultDependencies,
): Promise<ConnectedReadinessResult> {
  const [databaseResult, pravaResult, extractionResult, merchantResult] =
    await Promise.allSettled([
      dependencies.probeDatabase(),
      dependencies.probePravaAuthentication(),
      dependencies.extractIntent(canonicalReadinessRequest),
      dependencies.inspectOffer(),
    ]);

  const checks: ConnectedReadinessResult["checks"] = {
    database: settledBoolean(databaseResult, "DATABASE_UNAVAILABLE"),
    merchant:
      merchantResult.status === "fulfilled"
        ? { status: "ready" }
        : blocked("MERCHANT_OFFER_UNAVAILABLE"),
    openai:
      extractionResult.status === "fulfilled"
        ? { status: "ready" }
        : blocked(
            extractionResult.reason instanceof LiveOpenAiExtractionError
              ? extractionResult.reason.code
              : "OPENAI_UNAVAILABLE",
          ),
    paymentSafety: dependencies.probePaymentSafety()
      ? { status: "ready" }
      : blocked("PAYMENT_FLAGS_UNSAFE"),
    policy: blocked("DEPENDENCY_BLOCKED"),
    pravaAuthentication: settledBoolean(
      pravaResult,
      "PRAVA_AUTHENTICATION_UNAVAILABLE",
    ),
    senso: blocked("DEPENDENCY_BLOCKED"),
  };

  if (
    extractionResult.status === "fulfilled" &&
    merchantResult.status === "fulfilled"
  ) {
    try {
      const evidence = await dependencies.resolveEvidence(
        extractionResult.value.intent,
        merchantResult.value,
      );
      checks.senso = { status: "ready" };
      const decision = evaluateLivePurchasePolicy(
        extractionResult.value.intent,
        merchantResult.value,
        evidence,
        {
          minimumEvidenceScore: dependencies.minimumEvidenceScore,
          now: dependencies.now(),
        },
      );
      checks.policy =
        decision.status === "pass"
          ? { status: "ready" }
          : blocked(`POLICY_${decision.reasonCode}`);
    } catch {
      checks.senso = blocked("SENSO_POLICY_UNAVAILABLE");
    }
  }

  return {
    checkedAt: dependencies.now().toISOString(),
    checks,
    status: Object.values(checks).every((check) => check.status === "ready")
      ? "ready"
      : "blocked",
  };
}
