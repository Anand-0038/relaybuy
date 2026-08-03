import "server-only";

import { createHash } from "node:crypto";

import { chromium, type Frame } from "playwright";
import { z } from "zod";

import { pravaCustomerEmailSchema } from "@/integrations/prava/contract";
import type { PravaEphemeralCredentials } from "@/integrations/prava/sandbox-gateway";
import type { ApprovalArtifact, VerifiedMerchantOffer } from "@/live/types";

import {
  BONES_COFFEE_GIFT_CARD,
  type BonesCoffeeDeclineCode,
  buildVerifiedBonesCoffeeOffer,
  buildBonesCoffeeDiscovery,
  findNewBonesCoffeeDecline,
  isAllowedBonesCoffeeNavigation,
  isAllowedShopifyPaymentFrame,
  validateBonesCoffeeApproval,
} from "./bones-coffee-contract";

const checkoutProfileSchema = z
  .object({
    address1: z.string().trim().min(3),
    cardholderName: z
      .string()
      .trim()
      .min(3)
      .regex(/^[\p{L}][\p{L} .'-]*$/u),
    city: z.string().trim().min(2),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    email: pravaCustomerEmailSchema,
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    postalCode: z.string().trim().min(3),
    region: z.string().trim().min(2),
  })
  .strict();

export interface BonesCoffeeMerchantAttempt {
  adapter: typeof BONES_COFFEE_GIFT_CARD.adapter;
  attemptedAt: string;
  checkoutUrlDigest: string;
  declineCode: BonesCoffeeDeclineCode;
  merchantHost: typeof BONES_COFFEE_GIFT_CARD.merchantHost;
  noOrderCreated: true;
  outcome: "declined";
  paymentSubmitted: true;
}

export class BonesCoffeeCheckoutError extends Error {
  constructor(
    public readonly code:
      | "CHECKOUT_DISABLED"
      | "CHECKOUT_PROFILE_MISSING"
      | "LIVE_PRODUCT_CHANGED"
      | "MERCHANT_DOM_CHANGED"
      | "MERCHANT_OUTCOME_UNKNOWN"
      | "UNEXPECTED_ORDER_CREATED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BonesCoffeeCheckoutError";
  }
}

export function getBonesCoffeeCheckoutReadiness(): boolean {
  if (process.env.RELAYBUY_MERCHANT_ATTEMPT_ENABLED !== "true") return false;
  return checkoutProfileSchema.safeParse({
    address1: process.env.RELAYBUY_CHECKOUT_ADDRESS1,
    cardholderName: process.env.RELAYBUY_CHECKOUT_CARDHOLDER_NAME,
    city: process.env.RELAYBUY_CHECKOUT_CITY,
    countryCode: process.env.RELAYBUY_CHECKOUT_COUNTRY_CODE,
    email: process.env.RELAYBUY_CHECKOUT_EMAIL,
    firstName: process.env.RELAYBUY_CHECKOUT_FIRST_NAME,
    lastName: process.env.RELAYBUY_CHECKOUT_LAST_NAME,
    postalCode: process.env.RELAYBUY_CHECKOUT_POSTAL_CODE,
    region: process.env.RELAYBUY_CHECKOUT_REGION,
  }).success;
}

function getCheckoutProfile(): z.infer<typeof checkoutProfileSchema> {
  if (process.env.RELAYBUY_MERCHANT_ATTEMPT_ENABLED !== "true") {
    throw new BonesCoffeeCheckoutError(
      "CHECKOUT_DISABLED",
      "The real merchant attempt is disabled",
    );
  }

  const parsed = checkoutProfileSchema.safeParse({
    address1: process.env.RELAYBUY_CHECKOUT_ADDRESS1,
    cardholderName: process.env.RELAYBUY_CHECKOUT_CARDHOLDER_NAME,
    city: process.env.RELAYBUY_CHECKOUT_CITY,
    countryCode: process.env.RELAYBUY_CHECKOUT_COUNTRY_CODE,
    email: process.env.RELAYBUY_CHECKOUT_EMAIL,
    firstName: process.env.RELAYBUY_CHECKOUT_FIRST_NAME,
    lastName: process.env.RELAYBUY_CHECKOUT_LAST_NAME,
    postalCode: process.env.RELAYBUY_CHECKOUT_POSTAL_CODE,
    region: process.env.RELAYBUY_CHECKOUT_REGION,
  });
  if (!parsed.success) {
    throw new BonesCoffeeCheckoutError(
      "CHECKOUT_PROFILE_MISSING",
      "A genuine server-only billing profile is required for merchant checkout",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export async function inspectBonesCoffeeOffer(
  fetcher: typeof fetch = fetch,
): Promise<VerifiedMerchantOffer> {
  const response = await fetcher(
    `${BONES_COFFEE_GIFT_CARD.productUrl}.js?_t=${Date.now()}`,
    {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new BonesCoffeeCheckoutError(
      "LIVE_PRODUCT_CHANGED",
      "The merchant product could not be revalidated",
    );
  }
  try {
    return buildVerifiedBonesCoffeeOffer(await response.json());
  } catch (error) {
    throw new BonesCoffeeCheckoutError(
      "LIVE_PRODUCT_CHANGED",
      "The live merchant SKU, availability, fulfillment, or price changed",
      { cause: error },
    );
  }
}

export async function inspectBonesCoffeeDiscovery(fetchImpl = fetch) {
  const response = await fetchImpl(
    `${BONES_COFFEE_GIFT_CARD.productUrl}.js?_=${Date.now()}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok || response.status >= 300) {
    throw new BonesCoffeeCheckoutError(
      "LIVE_PRODUCT_CHANGED",
      `Merchant product lookup failed with status ${response.status}`,
    );
  }
  try {
    return buildBonesCoffeeDiscovery(await response.json());
  } catch (error) {
    throw new BonesCoffeeCheckoutError(
      "LIVE_PRODUCT_CHANGED",
      "The live merchant discovery feed changed",
      { cause: error },
    );
  }
}

export async function attemptBonesCoffeeCheckout(input: {
  artifact: ApprovalArtifact;
  credentials: PravaEphemeralCredentials;
  fetch?: typeof fetch;
}): Promise<BonesCoffeeMerchantAttempt> {
  validateBonesCoffeeApproval(input.artifact);
  const profile = getCheckoutProfile();
  await inspectBonesCoffeeOffer(input.fetch ?? fetch);

  const browser = await chromium.launch({
    args: ["--disable-dev-shm-usage"],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    headless: true,
  });

  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    let paymentFrameViolation = false;
    const paymentFrames: Frame[] = [];
    page.on("framenavigated", (frame) => {
      if (
        frame.name().startsWith("card-fields-") &&
        frame.url() !== "about:blank" &&
        !isAllowedShopifyPaymentFrame(frame.url())
      ) {
        paymentFrameViolation = true;
      }
    });
    context.on("page", (unexpectedPage) => {
      if (unexpectedPage !== page) {
        void unexpectedPage.close();
      }
    });
    page.on("download", (download) => {
      void download.cancel();
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        !isAllowedBonesCoffeeNavigation(request.url())
      ) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    await page.goto(BONES_COFFEE_GIFT_CARD.productUrl, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    const addResult = await page.evaluate(
      async ({ variantId }) => {
        const response = await fetch("/cart/add.js", {
          body: JSON.stringify({
            items: [{ id: variantId, quantity: 1 }],
          }),
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          method: "POST",
        });
        return { ok: response.ok, status: response.status };
      },
      { variantId: BONES_COFFEE_GIFT_CARD.variantId },
    );
    if (!addResult.ok) {
      throw new BonesCoffeeCheckoutError(
        "LIVE_PRODUCT_CHANGED",
        `The merchant rejected the canonical cart item (${addResult.status})`,
      );
    }

    await page.goto("https://www.bonescoffee.com/checkout", {
      timeout: 45_000,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2_000);
    if (new URL(page.url()).hostname !== BONES_COFFEE_GIFT_CARD.merchantHost) {
      throw new BonesCoffeeCheckoutError(
        "MERCHANT_DOM_CHANGED",
        "Checkout left the allowlisted merchant",
      );
    }

    const paymentFrameSelectors = [
      'iframe[name^="card-fields-number-"]',
      'iframe[name^="card-fields-expiry-"]',
      'iframe[name^="card-fields-verification_value-"]',
      'iframe[name^="card-fields-name-"]',
    ] as const;
    for (const selector of paymentFrameSelectors) {
      const frames = page.locator(selector);
      const frameElement = await frames.elementHandle();
      const contentFrame = await frameElement?.contentFrame();
      if (
        (await frames.count()) !== 1 ||
        !isAllowedShopifyPaymentFrame(
          (await frames.getAttribute("src")) ?? "",
        ) ||
        !contentFrame ||
        !isAllowedShopifyPaymentFrame(contentFrame.url())
      ) {
        throw new BonesCoffeeCheckoutError(
          "MERCHANT_DOM_CHANGED",
          "The Shopify payment frame origin was not allowlisted",
        );
      }
      paymentFrames.push(contentFrame);
    }

    const assertPaymentFramesStillAllowed = () => {
      if (
        paymentFrameViolation ||
        paymentFrames.some(
          (frame) => !isAllowedShopifyPaymentFrame(frame.url()),
        )
      ) {
        throw new BonesCoffeeCheckoutError(
          "MERCHANT_DOM_CHANGED",
          "A Shopify payment frame navigated outside the allowlist",
        );
      }
    };
    assertPaymentFramesStillAllowed();

    await page
      .locator('input[autocomplete="billing email"]')
      .first()
      .fill(profile.email);
    await page
      .locator('select[autocomplete="billing country-name"]')
      .first()
      .selectOption(profile.countryCode);
    await page
      .locator('input[autocomplete="billing given-name"][placeholder]')
      .first()
      .fill(profile.firstName);
    await page
      .locator('input[autocomplete="billing family-name"][placeholder]')
      .first()
      .fill(profile.lastName);
    await page
      .locator('input[autocomplete="billing address-line1"][placeholder]')
      .first()
      .fill(profile.address1);
    await page
      .locator('input[autocomplete="billing address-level2"][placeholder]')
      .first()
      .fill(profile.city);
    const region = page
      .locator('select[autocomplete="billing address-level1"]')
      .first();
    await region.selectOption({ label: profile.region }).catch(async () => {
      await region.selectOption(profile.region);
    });
    await page
      .locator('input[autocomplete="billing postal-code"][placeholder]')
      .first()
      .fill(profile.postalCode);

    await page
      .frameLocator('iframe[name^="card-fields-number-"]')
      .locator('input[name="number"]')
      .fill(input.credentials.token);
    await page
      .frameLocator('iframe[name^="card-fields-expiry-"]')
      .locator('input[name="expiry"]')
      .fill(
        `${input.credentials.expiryMonth}/${input.credentials.expiryYear.slice(-2)}`,
      );
    await page
      .frameLocator('iframe[name^="card-fields-verification_value-"]')
      .locator('input[name="verification_value"]')
      .fill(input.credentials.dynamicCvv);
    await page
      .frameLocator('iframe[name^="card-fields-name-"]')
      .locator('input[name="name"]')
      .fill(profile.cardholderName);

    assertPaymentFramesStillAllowed();
    const beforeSubmitText = await page.locator("body").innerText();
    await page.getByRole("button", { name: /^Pay now$/i }).click();
    await page
      .waitForFunction(
        (before) => {
          const body = document.body.innerText;
          return (
            location.pathname.includes("thank_you") ||
            (body !== before &&
              /(card (?:was|has been|is) declined|payment (?:could not|couldn't|was not) (?:be )?processed|payment details (?:could not|couldn't|were not) (?:be )?verified)/i.test(
                body,
              ))
          );
        },
        beforeSubmitText,
        { timeout: 35_000 },
      )
      .catch(() => undefined);

    const finalUrl = page.url();
    const finalText = await page.locator("body").innerText();
    if (!isAllowedBonesCoffeeNavigation(finalUrl)) {
      throw new BonesCoffeeCheckoutError(
        "MERCHANT_DOM_CHANGED",
        "Checkout left the allowlisted merchant",
      );
    }
    if (
      /thank_you|order-confirmation/i.test(finalUrl) ||
      /\bthank you for your (?:purchase|order)\b/i.test(finalText)
    ) {
      throw new BonesCoffeeCheckoutError(
        "UNEXPECTED_ORDER_CREATED",
        "The sandbox credential unexpectedly produced a merchant order",
      );
    }
    const declineCode = findNewBonesCoffeeDecline(beforeSubmitText, finalText);
    if (!declineCode) {
      throw new BonesCoffeeCheckoutError(
        "MERCHANT_OUTCOME_UNKNOWN",
        "Payment was submitted but the merchant outcome was not explicit",
      );
    }

    return {
      adapter: BONES_COFFEE_GIFT_CARD.adapter,
      attemptedAt: new Date().toISOString(),
      checkoutUrlDigest: createHash("sha256").update(finalUrl).digest("hex"),
      declineCode,
      merchantHost: BONES_COFFEE_GIFT_CARD.merchantHost,
      noOrderCreated: true,
      outcome: "declined",
      paymentSubmitted: true,
    };
  } finally {
    await browser.close();
  }
}
