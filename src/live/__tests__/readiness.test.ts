import { describe, expect, it, vi } from "vitest";

import { LiveOpenAiExtractionError } from "../openai-extractor";
import {
  canonicalReadinessRequest,
  probeConnectedReadiness,
  type ConnectedReadinessDependencies,
} from "../readiness";
import type {
  EvidenceBundle,
  PurchaseIntent,
  VerifiedMerchantOffer,
} from "../types";

const intent: PurchaseIntent = {
  approvedMerchantOnly: true,
  budgetMinor: 1_000,
  confidence: 0.99,
  currency: "USD",
  missingFields: [],
  neededBy: null,
  preferredMerchant: "Bones Coffee Company",
  quantity: 1,
  requestedColor: "$10.00",
  requestedProduct: "Bones Coffee Company gift card",
  requestedSize: "E-gift card",
};

const offer = {
  currency: "USD",
  expiresAt: "2026-08-01T12:30:00.000Z",
  feesMinor: 0,
  merchantName: "Bones Coffee Company",
  merchantUrl: "https://www.bonescoffee.com/products/gift-card",
  observedAt: "2026-08-01T12:00:00.000Z",
  productName: "Bones Coffee Company Gift Card",
  quantity: 1,
  quotedColor: "$10.00",
  quotedSize: "E-gift card",
  quoteTotalMinor: 1_000,
  sku: "25933838657",
  source: "merchant_product_json",
  sourceDigest: "a".repeat(64),
  unitPriceMinor: 1_000,
} satisfies VerifiedMerchantOffer;

const evidence = {
  authorization: {
    allowedSkus: [offer.sku],
    citationIds: [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ],
    contentId: "content",
    freshUntil: "2026-08-01T12:30:00.000Z",
    merchantDomain: "www.bonescoffee.com",
    merchantStatus: "approved",
    observedAt: "2026-08-01T12:00:00.000Z",
    productHandle: "gift-card",
    recordDigest: "b".repeat(64),
    schemaVersion: 1,
    versionId: "version-1",
  },
  merchant: {
    answer: "Bones Coffee Company is approved.",
    citations: [
      {
        chunkIndex: 0,
        chunkText:
          "Bones Coffee Company at www.bonescoffee.com is approved for SKU 25933838657.",
        contentId: "content",
        id: "00000000-0000-4000-8000-000000000001",
        rank: 1,
        score: 0.95,
        sourceType: "knowledge_base",
        title: "RelayBuy policy",
        versionId: "version-1",
      },
    ],
    kind: "merchant",
    query: "merchant",
  },
  retrievedAt: "2026-08-01T12:00:00.000Z",
  variant: {
    answer: "SKU 25933838657 is the $10.00 e-gift card.",
    citations: [
      {
        chunkIndex: 1,
        chunkText:
          "SKU 25933838657 is the Bones Coffee Company $10.00 e-gift card.",
        contentId: "content",
        id: "00000000-0000-4000-8000-000000000002",
        rank: 1,
        score: 0.95,
        sourceType: "knowledge_base",
        title: "RelayBuy policy",
        versionId: "version-1",
      },
    ],
    kind: "variant",
    query: "variant",
  },
} satisfies EvidenceBundle;

function dependencies(): ConnectedReadinessDependencies {
  return {
    extractIntent: vi.fn().mockResolvedValue({ intent, model: "test-model" }),
    inspectOffer: vi.fn().mockResolvedValue(offer),
    minimumEvidenceScore: 0.35,
    now: () => new Date("2026-08-01T12:05:00.000Z"),
    probeDatabase: vi.fn().mockResolvedValue(true),
    probePaymentSafety: vi.fn().mockReturnValue(true),
    probePravaAuthentication: vi.fn().mockResolvedValue(true),
    resolveEvidence: vi.fn().mockResolvedValue(evidence),
  };
}

describe("connected readiness", () => {
  it("runs the actual pre-payment dependency chain and reports ready", async () => {
    const result = await probeConnectedReadiness(dependencies());

    expect(canonicalReadinessRequest).toContain(
      'product "Bones Coffee Company Gift Card"',
    );
    expect(canonicalReadinessRequest).toContain(
      'preferred merchant "Bones Coffee Company"',
    );
    expect(canonicalReadinessRequest).toContain(
      'primary variant option is "$10.00"',
    );
    expect(canonicalReadinessRequest).toContain(
      'secondary type is "E-gift card"',
    );
    expect(result.status).toBe("ready");
    expect(result.checks).toEqual({
      database: { status: "ready" },
      merchant: { status: "ready" },
      openai: { status: "ready" },
      paymentSafety: { status: "ready" },
      policy: { status: "ready" },
      pravaAuthentication: { status: "ready" },
      senso: { status: "ready" },
    });
  });

  it("reports exhausted OpenAI quota as blocked without running Senso", async () => {
    const deps = dependencies();
    vi.mocked(deps.extractIntent).mockRejectedValue(
      new LiveOpenAiExtractionError("OPENAI_CAPACITY_UNAVAILABLE"),
    );

    const result = await probeConnectedReadiness(deps);

    expect(result.status).toBe("blocked");
    expect(result.checks.openai).toEqual({
      code: "OPENAI_CAPACITY_UNAVAILABLE",
      status: "blocked",
    });
    expect(deps.resolveEvidence).not.toHaveBeenCalled();
  });

  it("fails closed when immutable Senso authorization is unavailable", async () => {
    const deps = dependencies();
    vi.mocked(deps.resolveEvidence).mockRejectedValue(
      new Error("private Senso payload"),
    );

    const result = await probeConnectedReadiness(deps);

    expect(result.status).toBe("blocked");
    expect(result.checks.senso).toEqual({
      code: "SENSO_POLICY_UNAVAILABLE",
      status: "blocked",
    });
    expect(JSON.stringify(result)).not.toContain("private Senso payload");
  });
});
