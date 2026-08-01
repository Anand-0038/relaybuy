import {
  policyDecisionSchema,
  type EvidenceBundle,
  type PolicyDecision,
  type PurchaseIntent,
  type VerifiedMerchantOffer,
} from "./types";

const DEFAULT_MAX_EVIDENCE_AGE_MS = 30 * 60 * 1_000;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function same(left: string | null, right: string): boolean {
  return Boolean(left && normalize(left) === normalize(right));
}

function sameProduct(left: string | null, right: string): boolean {
  if (!left) {
    return false;
  }
  const requested = normalize(left);
  const offered = normalize(right);
  return (
    requested.length >= 4 &&
    offered.length >= 4 &&
    (requested === offered ||
      requested.includes(offered) ||
      offered.includes(requested))
  );
}

function refused(
  reasonCode: PolicyDecision["reasonCode"],
  reason: string,
  checks: PolicyDecision["checks"],
  quoteTotalMinor: number | null,
  decidedAt: string,
): PolicyDecision {
  return policyDecisionSchema.parse({
    checks,
    decidedAt,
    quoteTotalMinor,
    reason,
    reasonCode,
    status: "refuse",
  });
}

function hasAuthorizedCitation(
  search: EvidenceBundle["merchant"],
  evidence: EvidenceBundle,
  minimumScore: number,
): boolean {
  return search.citations.some(
    (citation) =>
      evidence.authorization.citationIds.includes(citation.id) &&
      citation.contentId === evidence.authorization.contentId &&
      citation.score >= minimumScore,
  );
}

export interface LivePolicyOptions {
  maxEvidenceAgeMs?: number;
  minimumEvidenceScore: number;
  now?: Date;
}

export function evaluateLivePurchasePolicy(
  intent: PurchaseIntent,
  offer: VerifiedMerchantOffer,
  evidence: EvidenceBundle,
  options: LivePolicyOptions,
): PolicyDecision {
  const now = options.now ?? new Date();
  const decidedAt = now.toISOString();
  const maxEvidenceAgeMs =
    options.maxEvidenceAgeMs ?? DEFAULT_MAX_EVIDENCE_AGE_MS;
  const missing = [
    ["budgetMinor", intent.budgetMinor],
    ["requestedColor", intent.requestedColor],
    ["requestedProduct", intent.requestedProduct],
    ["requestedSize", intent.requestedSize],
  ]
    .filter(([, value]) => value === null)
    .map(([key]) => String(key));

  if (missing.length > 0 || intent.missingFields.length > 0) {
    return refused(
      "MISSING_REQUIRED_FIELD",
      "The request is incomplete and cannot be approved.",
      [
        {
          code: "required_fields",
          detail: `Missing: ${[...new Set([...missing, ...intent.missingFields])].join(", ")}`,
          status: "fail",
        },
      ],
      null,
      decidedAt,
    );
  }

  const checks: PolicyDecision["checks"] = [];
  const evidenceObservedAt = new Date(
    evidence.authorization.observedAt,
  ).getTime();
  const evidenceRetrievedAt = new Date(evidence.retrievedAt).getTime();
  const evidenceFreshUntil = new Date(
    evidence.authorization.freshUntil,
  ).getTime();
  const nowMs = now.getTime();
  const maximumFutureSkewMs = 5 * 60_000;
  if (
    !Number.isFinite(evidenceObservedAt) ||
    !Number.isFinite(evidenceRetrievedAt) ||
    !Number.isFinite(evidenceFreshUntil) ||
    evidenceObservedAt - nowMs > maximumFutureSkewMs ||
    evidenceRetrievedAt - nowMs > maximumFutureSkewMs ||
    nowMs > evidenceFreshUntil ||
    nowMs - evidenceObservedAt > maxEvidenceAgeMs ||
    nowMs - evidenceRetrievedAt > maxEvidenceAgeMs
  ) {
    checks.push({
      code: "evidence.freshness",
      detail: "The structured Senso policy record is stale.",
      status: "fail",
    });
    return refused(
      "EVIDENCE_STALE",
      "Merchant policy evidence is stale and must be refreshed.",
      checks,
      offer.quoteTotalMinor,
      decidedAt,
    );
  }
  checks.push({
    code: "evidence.freshness",
    detail: `Evidence is current through ${evidence.authorization.freshUntil}.`,
    status: "pass",
  });

  const offerExpiresAt = new Date(offer.expiresAt).getTime();
  const offerObservedAt = new Date(offer.observedAt).getTime();
  if (
    !Number.isFinite(offerExpiresAt) ||
    !Number.isFinite(offerObservedAt) ||
    offerObservedAt - nowMs > maximumFutureSkewMs ||
    nowMs > offerExpiresAt ||
    nowMs - offerObservedAt > maxEvidenceAgeMs
  ) {
    checks.push({
      code: "quote.freshness",
      detail: "The verified merchant offer has expired.",
      status: "fail",
    });
    return refused(
      "QUOTE_EXPIRED",
      "The merchant offer expired and must be retrieved again.",
      checks,
      offer.quoteTotalMinor,
      decidedAt,
    );
  }
  checks.push({
    code: "quote.freshness",
    detail: `Merchant offer is current through ${offer.expiresAt}.`,
    status: "pass",
  });

  if (intent.quantity !== offer.quantity) {
    checks.push({
      code: "variant.quantity",
      detail: `Requested ${intent.quantity}; offered ${offer.quantity}.`,
      status: "fail",
    });
    return refused(
      "QUANTITY_MISMATCH",
      "Requested quantity does not match the verified merchant offer.",
      checks,
      offer.quoteTotalMinor,
      decidedAt,
    );
  }
  checks.push({
    code: "variant.quantity",
    detail: `Exact quantity match: ${offer.quantity}.`,
    status: "pass",
  });

  if (!sameProduct(intent.requestedProduct, offer.productName)) {
    checks.push({
      code: "product",
      detail: `Requested ${intent.requestedProduct}; offered ${offer.productName}.`,
      status: "fail",
    });
    return refused(
      "PRODUCT_MISMATCH",
      "Requested product does not match the verified merchant offer.",
      checks,
      offer.quoteTotalMinor,
      decidedAt,
    );
  }
  checks.push({
    code: "product",
    detail: `Verified product match: ${offer.productName}.`,
    status: "pass",
  });

  if (
    intent.preferredMerchant &&
    !sameProduct(intent.preferredMerchant, offer.merchantName)
  ) {
    checks.push({
      code: "merchant.preference",
      detail: `Preferred ${intent.preferredMerchant}; offered ${offer.merchantName}.`,
      status: "fail",
    });
    return refused(
      "MERCHANT_MISMATCH",
      "Verified offer does not match the requested merchant preference.",
      checks,
      offer.quoteTotalMinor,
      decidedAt,
    );
  }
  checks.push({
    code: "merchant.preference",
    detail: intent.preferredMerchant
      ? `Merchant preference matched: ${offer.merchantName}.`
      : "No merchant preference was requested.",
    status: "pass",
  });

  if (!same(intent.requestedSize, offer.quotedSize)) {
    checks.push({
      code: "variant.size",
      detail: `Requested ${intent.requestedSize}; offered ${offer.quotedSize}.`,
      status: "fail",
    });
    return refused(
      "SIZE_MISMATCH",
      "Requested size does not match the verified merchant variant.",
      checks,
      offer.quoteTotalMinor,
      decidedAt,
    );
  }
  checks.push({
    code: "variant.size",
    detail: `Exact size match: ${offer.quotedSize}.`,
    status: "pass",
  });

  if (!same(intent.requestedColor, offer.quotedColor)) {
    checks.push({
      code: "variant.color",
      detail: `Requested ${intent.requestedColor}; offered ${offer.quotedColor}.`,
      status: "fail",
    });
    return refused(
      "COLOR_MISMATCH",
      "Requested color does not match the verified merchant variant.",
      checks,
      offer.quoteTotalMinor,
      decidedAt,
    );
  }
  checks.push({
    code: "variant.color",
    detail: `Exact color match: ${offer.quotedColor}.`,
    status: "pass",
  });

  if (offer.currency !== intent.currency) {
    return refused(
      "MISSING_REQUIRED_FIELD",
      "The request and merchant offer currencies do not match.",
      [
        ...checks,
        {
          code: "budget.currency",
          detail: `Requested ${intent.currency}; offered ${offer.currency}.`,
          status: "fail",
        },
      ],
      offer.quoteTotalMinor,
      decidedAt,
    );
  }

  if (offer.quoteTotalMinor > intent.budgetMinor!) {
    checks.push({
      code: "budget",
      detail: `Quote ${offer.quoteTotalMinor} exceeds ceiling ${intent.budgetMinor}.`,
      status: "fail",
    });
    return refused(
      "BUDGET_EXCEEDED",
      "Verified merchant total exceeds the locked budget ceiling.",
      checks,
      offer.quoteTotalMinor,
      decidedAt,
    );
  }
  checks.push({
    code: "budget",
    detail: `Quote ${offer.quoteTotalMinor} is within ceiling ${intent.budgetMinor}.`,
    status: "pass",
  });

  const merchantDomain = new URL(offer.merchantUrl).hostname;
  const merchantEvidencePresent =
    evidence.authorization.merchantStatus === "approved" &&
    evidence.authorization.merchantDomain === merchantDomain &&
    hasAuthorizedCitation(
      evidence.merchant,
      evidence,
      options.minimumEvidenceScore,
    );
  if (!merchantEvidencePresent) {
    checks.push({
      code: "evidence.merchant",
      detail:
        "No allowlisted structured Senso record authorizes the exact merchant domain.",
      status: "fail",
    });
    return refused(
      "MERCHANT_EVIDENCE_MISSING",
      "Approved merchant evidence is missing or insufficient.",
      checks,
      offer.quoteTotalMinor,
      decidedAt,
    );
  }
  checks.push({
    code: "evidence.merchant",
    detail: "An allowlisted structured record authorizes the merchant.",
    status: "pass",
  });

  const productHandle = new URL(offer.merchantUrl).pathname
    .replace(/\/$/, "")
    .split("/")
    .at(-1);
  const variantEvidencePresent =
    evidence.authorization.productHandle === productHandle &&
    evidence.authorization.allowedSkus.includes(offer.sku) &&
    hasAuthorizedCitation(
      evidence.variant,
      evidence,
      options.minimumEvidenceScore,
    );
  if (!variantEvidencePresent) {
    checks.push({
      code: "evidence.variant",
      detail:
        "The allowlisted structured Senso record does not authorize the exact product and SKU.",
      status: "fail",
    });
    return refused(
      "VARIANT_EVIDENCE_MISSING",
      "Exact variant evidence is missing or insufficient.",
      checks,
      offer.quoteTotalMinor,
      decidedAt,
    );
  }
  checks.push({
    code: "evidence.variant",
    detail:
      "The structured policy record authorizes the exact product and SKU.",
    status: "pass",
  });

  return policyDecisionSchema.parse({
    checks,
    decidedAt,
    quoteTotalMinor: offer.quoteTotalMinor,
    reason: "All deterministic gates passed.",
    reasonCode: "PASS",
    status: "pass",
  });
}
