import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ApprovalArtifact } from "@/live/types";

import {
  BONES_COFFEE_GIFT_CARD,
  buildVerifiedBonesCoffeeOffer,
  findNewBonesCoffeeDecline,
  isAllowedBonesCoffeeNavigation,
  isAllowedShopifyPaymentFrame,
  validateBonesCoffeeApproval,
} from "./bones-coffee-contract";

function artifact(overrides: Partial<ApprovalArtifact> = {}): ApprovalArtifact {
  return {
    budgetMinor: 1_000,
    currency: "USD",
    evidenceIds: [randomUUID(), randomUUID()],
    evidenceContentId: "trusted-senso-content",
    evidenceFreshUntil: "2026-07-29T00:30:00.000Z",
    evidenceRecordDigest: "d".repeat(64),
    evidenceRetrievedAt: new Date().toISOString(),
    evidenceVersionId: "version-policy-1",
    feesMinor: 0,
    merchantName: BONES_COFFEE_GIFT_CARD.merchantName,
    merchantUrl: BONES_COFFEE_GIFT_CARD.productUrl,
    productName: BONES_COFFEE_GIFT_CARD.productName,
    quantity: 1,
    quoteExpiresAt: "2026-07-29T00:15:00.000Z",
    quoteObservedAt: "2026-07-29T00:00:00.000Z",
    quoteTotalMinor: BONES_COFFEE_GIFT_CARD.quoteTotalMinor,
    quotedColor: BONES_COFFEE_GIFT_CARD.variantLabel,
    quotedSize: "E-gift card",
    requestId: randomUUID(),
    sku: BONES_COFFEE_GIFT_CARD.sku,
    sourceDigest: "a".repeat(64),
    unitPriceMinor: BONES_COFFEE_GIFT_CARD.quoteTotalMinor,
    ...overrides,
  };
}

describe("Bones Coffee canonical checkout contract", () => {
  it("accepts only the exact approved live SKU and total", () => {
    expect(validateBonesCoffeeApproval(artifact())).toBeDefined();
  });

  it.each([
    ["wrong SKU", { sku: "25933838721" }],
    ["wrong denomination", { quotedColor: "$25.00" }],
    ["changed total", { quoteTotalMinor: 2_500 }],
    ["fees added", { feesMinor: 100 }],
    ["wrong merchant", { merchantUrl: "https://example.com/gift-card" }],
    ["multiple quantity", { quantity: 2 }],
  ])("rejects %s", (_name, override) => {
    expect(() =>
      validateBonesCoffeeApproval(
        artifact(override as Partial<ApprovalArtifact>),
      ),
    ).toThrow();
  });

  it("builds price, SKU, and merchant facts only from live product JSON", () => {
    const offer = buildVerifiedBonesCoffeeOffer(
      {
        available: true,
        handle: BONES_COFFEE_GIFT_CARD.productHandle,
        title: BONES_COFFEE_GIFT_CARD.productName,
        variants: [
          {
            available: true,
            id: BONES_COFFEE_GIFT_CARD.variantId,
            price: BONES_COFFEE_GIFT_CARD.quoteTotalMinor,
            requires_shipping: false,
            sku: BONES_COFFEE_GIFT_CARD.sku,
            taxable: false,
            title: BONES_COFFEE_GIFT_CARD.variantLabel,
          },
        ],
      },
      new Date("2026-07-29T00:00:00.000Z"),
    );

    expect(offer).toMatchObject({
      merchantName: BONES_COFFEE_GIFT_CARD.merchantName,
      quoteTotalMinor: 1_000,
      sku: BONES_COFFEE_GIFT_CARD.sku,
      source: "merchant_product_json",
    });
    expect(offer.expiresAt).toBe("2026-07-29T00:15:00.000Z");
  });

  it("fails closed when the live product price or fulfillment contract changes", () => {
    expect(() =>
      buildVerifiedBonesCoffeeOffer(
        {
          available: true,
          handle: BONES_COFFEE_GIFT_CARD.productHandle,
          title: BONES_COFFEE_GIFT_CARD.productName,
          variants: [
            {
              available: true,
              id: BONES_COFFEE_GIFT_CARD.variantId,
              price: 1_001,
              requires_shipping: false,
              sku: BONES_COFFEE_GIFT_CARD.sku,
              taxable: false,
              title: BONES_COFFEE_GIFT_CARD.variantLabel,
            },
          ],
        },
        new Date("2026-07-29T00:00:00.000Z"),
      ),
    ).toThrow();
  });

  it("allows only the pinned merchant for top-level browser navigation", () => {
    expect(
      isAllowedBonesCoffeeNavigation(
        "https://www.bonescoffee.com/checkouts/example",
      ),
    ).toBe(true);
    expect(
      isAllowedBonesCoffeeNavigation("https://checkout.attacker.example"),
    ).toBe(false);
    expect(
      isAllowedBonesCoffeeNavigation("javascript:alert(document.cookie)"),
    ).toBe(false);
  });

  it("allows credentials only into the pinned Shopify PCI frame origin", () => {
    expect(
      isAllowedShopifyPaymentFrame(
        "https://checkout.pci.shopifyinc.com/build/current/number-ltr.html",
      ),
    ).toBe(true);
    expect(
      isAllowedShopifyPaymentFrame("https://attacker.example/number-ltr.html"),
    ).toBe(false);
    expect(
      isAllowedShopifyPaymentFrame(
        "http://checkout.pci.shopifyinc.com/number-ltr.html",
      ),
    ).toBe(false);
  });

  it("does not treat pre-existing decline text as a new checkout outcome", () => {
    const stale = "Help: your card was declined in an earlier attempt.";
    expect(findNewBonesCoffeeDecline(stale, stale)).toBeNull();
    expect(
      findNewBonesCoffeeDecline(
        "Checkout ready",
        "Checkout ready. Your card was declined.",
      ),
    ).toBe("CARD_DECLINED");
  });
});
