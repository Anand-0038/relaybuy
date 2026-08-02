import { createHash } from "node:crypto";

import { z } from "zod";

import {
  merchantCandidateSchema,
  verifiedMerchantOfferSchema,
  type ApprovalArtifact,
  type VerifiedMerchantOffer,
} from "../types";
import type { MerchantCandidate } from "../types";

export const BONES_COFFEE_GIFT_CARD = {
  adapter: "bones_coffee_shopify_gift_card_v1",
  merchantHost: "www.bonescoffee.com",
  merchantName: "Bones Coffee Company",
  productHandle: "gift-card",
  productName: "Bones Coffee Company Gift Card",
  productUrl: "https://www.bonescoffee.com/products/gift-card",
  quoteTotalMinor: 1_000,
  sku: "25933838657",
  variantId: 25_933_838_657,
  variantLabel: "$10.00",
} as const;

export function isAllowedBonesCoffeeNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === BONES_COFFEE_GIFT_CARD.merchantHost
    );
  } catch {
    return false;
  }
}

export function isAllowedShopifyPaymentFrame(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "checkout.pci.shopifyinc.com"
    );
  } catch {
    return false;
  }
}

const declinePatterns = [
  {
    code: "CARD_DECLINED" as const,
    pattern: /card (?:was|has been|is) declined/i,
  },
  {
    code: "PAYMENT_NOT_PROCESSED" as const,
    pattern: /payment (?:could not|couldn't|was not) (?:be )?processed/i,
  },
  {
    code: "PAYMENT_DETAILS_REJECTED" as const,
    pattern:
      /payment details (?:could not|couldn't|were not) (?:be )?verified/i,
  },
];

export type BonesCoffeeDeclineCode = (typeof declinePatterns)[number]["code"];

export function findNewBonesCoffeeDecline(
  beforeSubmitText: string,
  finalText: string,
): BonesCoffeeDeclineCode | null {
  const decline = declinePatterns.find(
    ({ pattern }) => pattern.test(finalText) && !pattern.test(beforeSubmitText),
  );
  return decline?.code ?? null;
}

const merchantProductSchema = z
  .object({
    available: z.boolean(),
    handle: z.literal(BONES_COFFEE_GIFT_CARD.productHandle),
    title: z.literal(BONES_COFFEE_GIFT_CARD.productName),
    variants: z.array(
      z
        .object({
          available: z.boolean(),
          id: z.number().int(),
          price: z.number().int().nonnegative(),
          requires_shipping: z.boolean(),
          sku: z.string(),
          taxable: z.boolean(),
          title: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export function buildVerifiedBonesCoffeeOffer(
  payload: unknown,
  observedAt = new Date(),
): VerifiedMerchantOffer {
  const product = merchantProductSchema.parse(payload);
  const variant = product.variants.find(
    (candidate) =>
      candidate.id === BONES_COFFEE_GIFT_CARD.variantId &&
      candidate.sku === BONES_COFFEE_GIFT_CARD.sku,
  );
  if (
    !product.available ||
    !variant?.available ||
    variant.price !== BONES_COFFEE_GIFT_CARD.quoteTotalMinor ||
    variant.requires_shipping ||
    variant.taxable ||
    variant.title !== BONES_COFFEE_GIFT_CARD.variantLabel
  ) {
    throw new Error(
      "The live merchant SKU, availability, fulfillment, or price changed",
    );
  }

  return verifiedMerchantOfferSchema.parse({
    currency: "USD",
    expiresAt: new Date(observedAt.getTime() + 15 * 60_000).toISOString(),
    feesMinor: 0,
    merchantName: BONES_COFFEE_GIFT_CARD.merchantName,
    merchantUrl: BONES_COFFEE_GIFT_CARD.productUrl,
    observedAt: observedAt.toISOString(),
    productName: product.title,
    quantity: 1,
    quotedColor: variant.title,
    quotedSize: "E-gift card",
    quoteTotalMinor: variant.price,
    sku: variant.sku,
    source: "merchant_product_json",
    sourceDigest: createHash("sha256")
      .update(JSON.stringify(product))
      .digest("hex"),
    unitPriceMinor: variant.price,
  });
}

export function buildBonesCoffeeDiscovery(
  payload: unknown,
  observedAt = new Date(),
): {
  candidates: MerchantCandidate[];
  selectedOffer: VerifiedMerchantOffer;
} {
  const product = merchantProductSchema.parse(payload);
  const selectedOffer = buildVerifiedBonesCoffeeOffer(payload, observedAt);
  const candidates = product.variants
    .filter(
      (variant) =>
        variant.available && !variant.requires_shipping && !variant.taxable,
    )
    .map((variant) =>
      merchantCandidateSchema.parse({
        currency: "USD",
        executionEligible:
          variant.id === BONES_COFFEE_GIFT_CARD.variantId &&
          variant.sku === BONES_COFFEE_GIFT_CARD.sku &&
          variant.price === BONES_COFFEE_GIFT_CARD.quoteTotalMinor,
        merchantName: BONES_COFFEE_GIFT_CARD.merchantName,
        optionLabel: variant.title,
        productName: product.title,
        sku: variant.sku,
        totalMinor: variant.price,
      }),
    );
  if (!candidates.some((candidate) => candidate.executionEligible)) {
    throw new Error("The canonical execution candidate is unavailable");
  }
  return { candidates, selectedOffer };
}

const canonicalArtifactSchema = z
  .object({
    currency: z.literal("USD"),
    feesMinor: z.literal(0),
    merchantName: z.string().min(1),
    merchantUrl: z.url(),
    productName: z.string().min(1),
    quantity: z.literal(1),
    quoteTotalMinor: z.literal(BONES_COFFEE_GIFT_CARD.quoteTotalMinor),
    quotedColor: z.literal(BONES_COFFEE_GIFT_CARD.variantLabel),
    quotedSize: z.string().min(1),
    sku: z.literal(BONES_COFFEE_GIFT_CARD.sku),
    unitPriceMinor: z.literal(BONES_COFFEE_GIFT_CARD.quoteTotalMinor),
  })
  .passthrough()
  .superRefine((artifact, context) => {
    const url = new URL(artifact.merchantUrl);
    if (
      url.hostname !== BONES_COFFEE_GIFT_CARD.merchantHost ||
      url.pathname.replace(/\/$/, "") !==
        `/products/${BONES_COFFEE_GIFT_CARD.productHandle}`
    ) {
      context.addIssue({
        code: "custom",
        message: "The approval is not bound to the canonical merchant product",
      });
    }
  });

export function validateBonesCoffeeApproval(
  artifact: ApprovalArtifact,
): ApprovalArtifact {
  canonicalArtifactSchema.parse(artifact);
  return artifact;
}
