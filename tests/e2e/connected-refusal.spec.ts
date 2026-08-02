import { expect, test } from "@playwright/test";

const connectedTest =
  process.env.RUN_CONNECTED_E2E === "true" ? test : test.skip;

test.setTimeout(120_000);

connectedTest(
  "records the real refusal before any Prava session",
  async ({ page }) => {
    await page.goto("/live");
    await page.getByRole("button", { name: "Run refusal proof" }).click();

    await expect(page.getByText("refused", { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await expect(
      page.getByRole("heading", { name: "Prava session: not created" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open artifact approval" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open Prava passkey approval" }),
    ).toHaveCount(0);
    await expect(page.getByText("DENOMINATION_MISMATCH")).toBeVisible();
    await expect(
      page.getByText(
        "Requested denomination: $25.00. Authorized denomination: $10.00.",
      ),
    ).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: "../artifacts/relaybuy-refusal-first-2026-08-02.png",
    });
  },
);

connectedTest(
  "records the real exact candidate while payment stays unreachable",
  async ({ page }) => {
    await page.goto("/live");
    await page.getByRole("button", { name: /2\. Exact candidate/ }).click();
    await page.getByRole("button", { name: "Run evidence path" }).click();

    await expect(page.getByText("PASS", { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await expect(
      page.getByRole("button", {
        name: "Approval unavailable: payment runtime disabled",
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("heading", { name: "Prava session: not created" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open artifact approval" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open Prava passkey approval" }),
    ).toHaveCount(0);

    await page.screenshot({
      fullPage: true,
      path: "../artifacts/relaybuy-exact-preapproval-2026-08-02.png",
    });
  },
);
