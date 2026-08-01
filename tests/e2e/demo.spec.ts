import { expect, test } from "@playwright/test";

test("the root route opens the current fail-closed connected control plane", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/live$/);
  await expect(
    page.getByRole("heading", { name: "Buying, without guessing." }),
  ).toBeVisible();
  await expect(
    page.getByText("SANDBOX — PAYMENT MECHANICS ONLY"),
  ).toBeVisible();
  await expect(page.getByLabel("Natural-language request")).toHaveValue(
    /Bones Coffee Company gift card/,
  );
  await expect(
    page.getByRole("heading", { name: "No session created" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open artifact approval" }),
  ).toHaveCount(0);
});

test("the retired replay route cannot expose replay mutation controls", async ({
  page,
}) => {
  await page.goto("/demo");

  await expect(page).toHaveURL(/\/live$/);
  await expect(
    page.getByRole("button", { name: "Record replay approval" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Complete no-payment replay" }),
  ).toHaveCount(0);
});

test("retired replay APIs are removed", async ({ request }) => {
  const response = await request.get("/api/demo/snapshot");

  expect(response.status()).toBe(404);
});

test("legacy approval capability routes redirect without an approval action", async ({
  page,
}) => {
  await page.goto("/approve/expired");

  await expect(page).toHaveURL(/\/live$/);
  await expect(
    page.getByRole("button", { name: "Approve exact artifact" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No session created" }),
  ).toBeVisible();
});

test("the single-use Prava approval launch cannot be opened twice", async ({
  context,
  page,
}) => {
  const token = "a".repeat(32);
  const now = "2026-07-31T17:00:00.000Z";
  await page.route(`**/api/live/approve/${token}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        request: {
          approval: {
            approvedAt: now,
            artifact: {
              budgetMinor: 1_000,
              currency: "USD",
              evidenceIds: [
                "00000000-0000-4000-8000-000000000001",
                "00000000-0000-4000-8000-000000000002",
              ],
              evidenceContentId: "content-1",
              evidenceFreshUntil: "2026-07-31T18:00:00.000Z",
              evidenceRecordDigest: "d".repeat(64),
              evidenceRetrievedAt: now,
              evidenceVersionId: "version-policy-1",
              feesMinor: 0,
              merchantName: "Bones Coffee Company",
              merchantUrl: "https://www.bonescoffee.com/products/gift-card",
              productName: "Bones Coffee Company Gift Card",
              quantity: 1,
              quoteExpiresAt: "2026-07-31T18:00:00.000Z",
              quoteObservedAt: now,
              quoteTotalMinor: 1_000,
              quotedColor: "$10.00",
              quotedSize: "E-gift card",
              requestId: "00000000-0000-4000-8000-000000000003",
              sku: "25933838657",
              sourceDigest: "a".repeat(64),
              unitPriceMinor: 1_000,
            },
            artifactHash: "b".repeat(64),
            expiresAt: "2026-07-31T18:00:00.000Z",
          },
          audit: [],
          createdAt: now,
          evidence: null,
          expiresAt: "2026-07-31T20:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000003",
          intent: null,
          offer: null,
          policyDecision: null,
          prava: {
            approvalUrl:
              "https://sandbox.collect.prava.space/session/single-use-test",
            claim: "payment_mechanics_only",
            createdAt: now,
            credentialsReady: false,
            expiresAt: "2026-07-31T18:00:00.000Z",
            mode: "sandbox",
            redactedSessionRef: "sandbox-v1.redacted-reference-for-test",
            status: "pending",
            txnRefId: null,
            updatedAt: now,
          },
          publicId: "RB-TEST0001",
          requestText: "Buy the approved ten dollar gift card",
          source: "web",
          state: "prava_pending",
          updatedAt: now,
          version: 7,
        },
      },
      status: 200,
    }),
  );
  await context.route("https://sandbox.collect.prava.space/**", (route) =>
    route.fulfill({ body: "approval", contentType: "text/plain" }),
  );

  await page.goto(`/live/approve/${token}`);
  const launch = page.getByRole("link", { name: "Open Prava hosted approval" });
  await expect(launch).toBeVisible();
  const popup = page.waitForEvent("popup");
  await launch.click();
  await popup;

  await expect(launch).toHaveCount(0);
  await expect(page.getByText(/approval link was opened once/i)).toBeVisible();
});
