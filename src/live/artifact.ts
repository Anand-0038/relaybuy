import { createHash, createHmac, randomBytes } from "node:crypto";

import type {
  ApprovalArtifact,
  EvidenceBundle,
  LiveRequestSnapshot,
  VerifiedMerchantOffer,
} from "./types";
import { approvalArtifactSchema } from "./types";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function hashApprovalArtifact(artifact: ApprovalArtifact): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(artifact)))
    .digest("hex");
}

export function createApprovalArtifact(
  request: LiveRequestSnapshot,
): ApprovalArtifact {
  const { evidence, intent, offer, policyDecision } = request;
  if (!intent || !offer || !evidence || policyDecision?.status !== "pass") {
    throw new Error("Request is not eligible for an approval artifact");
  }

  const evidenceIds = [
    ...evidence.merchant.citations.map((citation) => citation.id),
    ...evidence.variant.citations.map((citation) => citation.id),
  ];

  return approvalArtifactSchema.parse({
    budgetMinor: intent.budgetMinor,
    currency: offer.currency,
    evidenceContentId: evidence.authorization.contentId,
    evidenceFreshUntil: evidence.authorization.freshUntil,
    evidenceIds,
    evidenceRecordDigest: evidence.authorization.recordDigest,
    evidenceRetrievedAt: evidence.retrievedAt,
    evidenceVersionId: evidence.authorization.versionId,
    feesMinor: offer.feesMinor,
    merchantName: offer.merchantName,
    merchantUrl: offer.merchantUrl,
    productName: offer.productName,
    quantity: offer.quantity,
    quoteExpiresAt: offer.expiresAt,
    quoteObservedAt: offer.observedAt,
    quoteTotalMinor: policyDecision.quoteTotalMinor,
    quotedColor: offer.quotedColor,
    quotedSize: offer.quotedSize,
    requestId: request.id,
    sku: offer.sku,
    sourceDigest: offer.sourceDigest,
    unitPriceMinor: offer.unitPriceMinor,
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}

export function assertApprovalStillCurrent(
  artifact: ApprovalArtifact,
  offer: VerifiedMerchantOffer,
  evidence: EvidenceBundle,
  now = new Date(),
): void {
  if (
    now.getTime() > new Date(evidence.authorization.freshUntil).getTime() ||
    now.getTime() > new Date(artifact.evidenceFreshUntil).getTime()
  ) {
    throw new Error("EVIDENCE_STALE");
  }
  if (
    now.getTime() > new Date(offer.expiresAt).getTime() ||
    now.getTime() > new Date(artifact.quoteExpiresAt).getTime()
  ) {
    throw new Error("QUOTE_EXPIRED");
  }

  const approvedFacts = {
    currency: artifact.currency,
    evidenceContentId: artifact.evidenceContentId,
    evidenceRecordDigest: artifact.evidenceRecordDigest,
    evidenceVersionId: artifact.evidenceVersionId,
    feesMinor: artifact.feesMinor,
    merchantName: artifact.merchantName,
    merchantUrl: artifact.merchantUrl,
    productName: artifact.productName,
    quantity: artifact.quantity,
    quoteTotalMinor: artifact.quoteTotalMinor,
    quotedColor: artifact.quotedColor,
    quotedSize: artifact.quotedSize,
    sku: artifact.sku,
    sourceDigest: artifact.sourceDigest,
    unitPriceMinor: artifact.unitPriceMinor,
  };
  const currentFacts = {
    currency: offer.currency,
    evidenceContentId: evidence.authorization.contentId,
    evidenceRecordDigest: evidence.authorization.recordDigest,
    evidenceVersionId: evidence.authorization.versionId,
    feesMinor: offer.feesMinor,
    merchantName: offer.merchantName,
    merchantUrl: offer.merchantUrl,
    productName: offer.productName,
    quantity: offer.quantity,
    quoteTotalMinor: offer.quoteTotalMinor,
    quotedColor: offer.quotedColor,
    quotedSize: offer.quotedSize,
    sku: offer.sku,
    sourceDigest: offer.sourceDigest,
    unitPriceMinor: offer.unitPriceMinor,
  };
  if (!sameJson(approvedFacts, currentFacts)) {
    throw new Error("APPROVED_PAYLOAD_CHANGED");
  }
}

export function issueApprovalToken(): string {
  return randomBytes(32).toString("base64url");
}

export function issueRequestToken(): string {
  return `rb_req_${randomBytes(32).toString("base64url")}`;
}

export function hashApprovalToken(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token).digest("hex");
}
