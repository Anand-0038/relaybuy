import { describe, expect, it } from "vitest";

import { purchaseIntentSchema, verifiedMerchantOfferSchema } from "../types";

describe("connected trust-boundary schemas", () => {
  it("rejects model output that tries to supply merchant commerce facts", () => {
    const intent = {
      approvedMerchantOnly: true,
      budgetMinor: 1_000,
      confidence: 0.9,
      currency: "USD",
      merchantUrl: "https://attacker.example/product",
      missingFields: [],
      neededBy: null,
      preferredMerchant: "Bones Coffee Company",
      quantity: 1,
      requestedColor: "$10.00",
      requestedProduct: "gift card",
      requestedSize: "E-gift card",
      sku: "model-invented-sku",
      unitPriceMinor: 1,
    };

    expect(purchaseIntentSchema.safeParse(intent).success).toBe(false);
  });

  it("rejects a merchant offer whose total does not match its arithmetic", () => {
    expect(
      verifiedMerchantOfferSchema.safeParse({
        currency: "USD",
        expiresAt: "2026-07-29T00:15:00.000Z",
        feesMinor: 0,
        merchantName: "Bones Coffee Company",
        merchantUrl: "https://www.bonescoffee.com/products/gift-card",
        observedAt: "2026-07-29T00:00:00.000Z",
        productName: "Gift Card",
        quantity: 1,
        quotedColor: "$10.00",
        quotedSize: "E-gift card",
        quoteTotalMinor: 999,
        sku: "25933838657",
        source: "merchant_product_json",
        sourceDigest: "a".repeat(64),
        unitPriceMinor: 1_000,
      }).success,
    ).toBe(false);
  });
});
