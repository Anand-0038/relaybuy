import { describe, expect, it } from "vitest";

import { evaluateLivePurchasePolicy } from "../policy";
import type {
  EvidenceBundle,
  PurchaseIntent,
  VerifiedMerchantOffer,
} from "../types";

const baseIntent: PurchaseIntent = {
  approvedMerchantOnly: true,
  budgetMinor: 8_000,
  confidence: 0.98,
  currency: "USD",
  missingFields: [],
  neededBy: null,
  preferredMerchant: "Northstar Apparel",
  quantity: 2,
  requestedColor: "Black",
  requestedProduct: "Everyday Crew Tee",
  requestedSize: "Medium",
};

const offer: VerifiedMerchantOffer = {
  currency: "USD",
  expiresAt: "2026-07-29T00:30:00.000Z",
  feesMinor: 400,
  merchantName: "Northstar Apparel",
  merchantUrl: "https://northstar.example/products/everyday-crew-tee",
  observedAt: "2026-07-29T00:00:00.000Z",
  productName: "Everyday Crew Tee",
  quantity: 2,
  quotedColor: "Black",
  quotedSize: "Medium",
  quoteTotalMinor: 6_400,
  sku: "ECT-BLK-M",
  source: "merchant_product_json",
  sourceDigest: "a".repeat(64),
  unitPriceMinor: 3_000,
};

const evidence: EvidenceBundle = {
  authorization: {
    allowedSkus: ["ECT-BLK-M"],
    citationIds: [
      "b333fe53-6f10-49a2-bc07-0ea223656840",
      "2e30bad9-6609-458c-ac0a-1f2e2684ad29",
    ],
    contentId: "merchant-policy",
    freshUntil: "2026-07-29T00:30:00.000Z",
    merchantDomain: "northstar.example",
    merchantStatus: "approved",
    observedAt: "2026-07-29T00:00:00.000Z",
    productHandle: "everyday-crew-tee",
    recordDigest: "d".repeat(64),
    schemaVersion: 1,
    versionId: "version-policy-1",
  },
  merchant: {
    answer: "Northstar Apparel is an approved merchant.",
    citations: [
      {
        chunkIndex: 0,
        chunkText: "Northstar Apparel appears on the approved merchant list.",
        contentId: "merchant-policy",
        id: "b333fe53-6f10-49a2-bc07-0ea223656840",
        rank: 1,
        score: 0.9,
        sourceType: "knowledge_base",
        title: "Approved Merchant Policy",
        versionId: "version-policy-1",
      },
    ],
    kind: "merchant",
    query: "merchant",
  },
  retrievedAt: "2026-07-29T00:00:00.000Z",
  variant: {
    answer: "ECT-BLK-M is black and medium.",
    citations: [
      {
        chunkIndex: 0,
        chunkText: "SKU ECT-BLK-M is Everyday Crew Tee, black, medium.",
        contentId: "merchant-policy",
        id: "2e30bad9-6609-458c-ac0a-1f2e2684ad29",
        rank: 1,
        score: 0.9,
        sourceType: "knowledge_base",
        title: "Product Catalog",
        versionId: "version-policy-1",
      },
    ],
    kind: "variant",
    query: "variant",
  },
};

describe("live purchase policy", () => {
  it("refuses a size mismatch before evidence approval", () => {
    const decision = evaluateLivePurchasePolicy(
      baseIntent,
      { ...offer, quotedSize: "Small" },
      evidence,
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T00:10:00.000Z"),
      },
    );
    expect(decision.reasonCode).toBe("SIZE_MISMATCH");
  });

  it("describes a gift-card option mismatch as a denomination mismatch", () => {
    const decision = evaluateLivePurchasePolicy(
      {
        ...baseIntent,
        budgetMinor: 1_000,
        preferredMerchant: "Bones Coffee Company",
        quantity: 1,
        requestedColor: "$25.00",
        requestedProduct: "Bones Coffee Company Gift Card",
        requestedSize: "E-gift card",
      },
      {
        ...offer,
        feesMinor: 0,
        merchantName: "Bones Coffee Company",
        merchantUrl: "https://www.bonescoffee.com/products/gift-card",
        productName: "Bones Coffee Company Gift Card",
        quantity: 1,
        quotedColor: "$10.00",
        quotedSize: "E-gift card",
        quoteTotalMinor: 1_000,
        unitPriceMinor: 1_000,
      },
      evidence,
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T00:10:00.000Z"),
      },
    );

    expect(decision.reasonCode).toBe("DENOMINATION_MISMATCH");
    expect(decision.checks.at(-1)).toMatchObject({
      code: "variant.denomination",
      detail:
        "Requested denomination: $25.00. Authorized denomination: $10.00.",
      status: "fail",
    });
  });

  it("retains color mismatch semantics for non-gift-card products", () => {
    const decision = evaluateLivePurchasePolicy(
      { ...baseIntent, requestedColor: "Navy" },
      offer,
      evidence,
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T00:10:00.000Z"),
      },
    );

    expect(decision.reasonCode).toBe("COLOR_MISMATCH");
    expect(decision.checks.at(-1)?.code).toBe("variant.color");
  });

  it("refuses an over-budget quote", () => {
    const decision = evaluateLivePurchasePolicy(
      baseIntent,
      { ...offer, quoteTotalMinor: 8_600, unitPriceMinor: 4_100 },
      evidence,
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T00:10:00.000Z"),
      },
    );
    expect(decision.reasonCode).toBe("BUDGET_EXCEEDED");
  });

  it("refuses a merchant offer with the wrong quantity", () => {
    const decision = evaluateLivePurchasePolicy(
      { ...baseIntent, quantity: 3 },
      offer,
      evidence,
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T00:10:00.000Z"),
      },
    );

    expect(decision.reasonCode).toBe("QUANTITY_MISMATCH");
  });

  it("refuses an unrelated merchant product", () => {
    const decision = evaluateLivePurchasePolicy(
      { ...baseIntent, requestedProduct: "Replacement toner cartridge" },
      offer,
      evidence,
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T00:10:00.000Z"),
      },
    );

    expect(decision.reasonCode).toBe("PRODUCT_MISMATCH");
  });

  it("refuses an offer from a different preferred merchant", () => {
    const decision = evaluateLivePurchasePolicy(
      { ...baseIntent, preferredMerchant: "Contoso Supply" },
      offer,
      evidence,
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T00:10:00.000Z"),
      },
    );

    expect(decision.reasonCode).toBe("MERCHANT_MISMATCH");
  });

  it("fails closed when the evidence bundle is stale", () => {
    const decision = evaluateLivePurchasePolicy(baseIntent, offer, evidence, {
      minimumEvidenceScore: 0.35,
      now: new Date("2026-07-29T00:31:00.000Z"),
    });

    expect(decision.reasonCode).toBe("EVIDENCE_STALE");
  });

  it("honors a digest-bound policy record's explicit freshness window", () => {
    const decision = evaluateLivePurchasePolicy(
      baseIntent,
      {
        ...offer,
        expiresAt: "2026-07-29T04:30:00.000Z",
        observedAt: "2026-07-29T04:00:00.000Z",
      },
      {
        ...evidence,
        authorization: {
          ...evidence.authorization,
          freshUntil: "2026-07-29T12:00:00.000Z",
          observedAt: "2026-07-29T00:00:00.000Z",
        },
        retrievedAt: "2026-07-29T04:00:00.000Z",
      },
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T04:10:00.000Z"),
      },
    );

    expect(decision.status).toBe("pass");
  });

  it("fails closed when evidence or quote timestamps are future-dated", () => {
    const futureEvidence = evaluateLivePurchasePolicy(
      baseIntent,
      offer,
      {
        ...evidence,
        authorization: {
          ...evidence.authorization,
          observedAt: "2026-07-29T00:20:01.000Z",
        },
      },
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T00:10:00.000Z"),
      },
    );
    expect(futureEvidence.reasonCode).toBe("EVIDENCE_STALE");

    const futureQuote = evaluateLivePurchasePolicy(
      baseIntent,
      { ...offer, observedAt: "2026-07-29T00:20:01.000Z" },
      evidence,
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T00:10:00.000Z"),
      },
    );
    expect(futureQuote.reasonCode).toBe("QUOTE_EXPIRED");
  });

  it("does not treat a negated substring match as merchant authorization", () => {
    const decision = evaluateLivePurchasePolicy(
      baseIntent,
      offer,
      {
        ...evidence,
        authorization: {
          ...evidence.authorization,
          contentId: "trusted-structured-policy",
        },
        merchant: {
          ...evidence.merchant,
          answer: "Northstar Apparel is not approved.",
          citations: evidence.merchant.citations.map((citation) => ({
            ...citation,
            chunkText:
              "Northstar Apparel is not an approved merchant and purchases must be blocked.",
          })),
        },
      },
      {
        minimumEvidenceScore: 0.35,
        now: new Date("2026-07-29T00:10:00.000Z"),
      },
    );

    expect(decision.reasonCode).toBe("MERCHANT_EVIDENCE_MISSING");
  });

  it("passes only exact independently verified offer and structured evidence facts", () => {
    const decision = evaluateLivePurchasePolicy(baseIntent, offer, evidence, {
      minimumEvidenceScore: 0.35,
      now: new Date("2026-07-29T00:10:00.000Z"),
    });

    expect(decision.reasonCode).toBe("PASS");
    expect(decision.quoteTotalMinor).toBe(6_400);
  });
});
