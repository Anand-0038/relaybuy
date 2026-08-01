import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { assertApprovalStillCurrent } from "../artifact";
import type {
  ApprovalArtifact,
  EvidenceBundle,
  VerifiedMerchantOffer,
} from "../types";

const citationIds = [randomUUID(), randomUUID()];
const offer: VerifiedMerchantOffer = {
  currency: "USD",
  expiresAt: "2026-07-29T00:15:00.000Z",
  feesMinor: 0,
  merchantName: "Bones Coffee Company",
  merchantUrl: "https://www.bonescoffee.com/products/gift-card",
  observedAt: "2026-07-29T00:00:00.000Z",
  productName: "Bones Coffee Company Gift Card",
  quantity: 1,
  quotedColor: "$10.00",
  quotedSize: "E-gift card",
  quoteTotalMinor: 1_000,
  sku: "25933838657",
  source: "merchant_product_json",
  sourceDigest: "a".repeat(64),
  unitPriceMinor: 1_000,
};
const evidence: EvidenceBundle = {
  authorization: {
    allowedSkus: [offer.sku],
    citationIds,
    contentId: "trusted-content",
    freshUntil: "2026-07-29T00:30:00.000Z",
    merchantDomain: "www.bonescoffee.com",
    merchantStatus: "approved",
    observedAt: "2026-07-29T00:00:00.000Z",
    productHandle: "gift-card",
    recordDigest: "d".repeat(64),
    schemaVersion: 1,
    versionId: "version-policy-1",
  },
  merchant: {
    answer: "",
    citations: [],
    kind: "merchant",
    query: "merchant",
  },
  retrievedAt: "2026-07-29T00:00:00.000Z",
  variant: {
    answer: "",
    citations: [],
    kind: "variant",
    query: "variant",
  },
};
const artifact: ApprovalArtifact = {
  budgetMinor: 1_000,
  currency: offer.currency,
  evidenceContentId: evidence.authorization.contentId,
  evidenceFreshUntil: evidence.authorization.freshUntil,
  evidenceIds: citationIds,
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
  quoteTotalMinor: offer.quoteTotalMinor,
  quotedColor: offer.quotedColor,
  quotedSize: offer.quotedSize,
  requestId: randomUUID(),
  sku: offer.sku,
  sourceDigest: offer.sourceDigest,
  unitPriceMinor: offer.unitPriceMinor,
};

describe("approval artifact revalidation", () => {
  it("accepts unchanged authoritative facts while both evidence and quote are fresh", () => {
    expect(() =>
      assertApprovalStillCurrent(
        artifact,
        offer,
        evidence,
        new Date("2026-07-29T00:10:00.000Z"),
      ),
    ).not.toThrow();
  });

  it("invalidates approval when a merchant fact changes", () => {
    expect(() =>
      assertApprovalStillCurrent(
        artifact,
        {
          ...offer,
          quoteTotalMinor: 1_001,
          unitPriceMinor: 1_001,
        },
        evidence,
        new Date("2026-07-29T00:10:00.000Z"),
      ),
    ).toThrow("APPROVED_PAYLOAD_CHANGED");
  });

  it("invalidates approval after evidence expiry", () => {
    expect(() =>
      assertApprovalStillCurrent(
        artifact,
        offer,
        evidence,
        new Date("2026-07-29T00:31:00.000Z"),
      ),
    ).toThrow("EVIDENCE_STALE");
  });
});
