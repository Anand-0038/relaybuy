import { expect, test } from "@playwright/test";

const connectedTest =
  process.env.RUN_CONNECTED_E2E === "true" ? test : test.skip;

test.setTimeout(120_000);

connectedTest(
  "records the real refusal before any Prava session",
  async ({ page }) => {
    await page.goto("/live");
    await page
      .getByLabel("Natural-language request")
      .fill(
        [
          "Buy 1 Bones Coffee Company gift card.",
          "I need the $25.00 denomination as an e-gift card.",
          "Keep the total at or below $25.00 USD and use an approved merchant only.",
        ].join(" "),
      );
    await page.getByRole("button", { name: "Run evidence path" }).click();

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
    await expect(page.getByText("COLOR_MISMATCH")).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: "../artifacts/relaybuy-refusal-first-2026-08-02.png",
    });
  },
);
