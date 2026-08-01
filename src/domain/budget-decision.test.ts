import { describe, expect, it } from "vitest";

import { evaluateBudget } from "./budget-decision";

describe("evaluateBudget", () => {
  it("approves a quote exactly at the remaining cap", () => {
    expect(
      evaluateBudget({
        quoteTotal: { amountMinor: 9_500, currency: "USD" },
        remainingBudget: { amountMinor: 9_500, currency: "usd" },
      }),
    ).toEqual({
      status: "approved",
      reasonCode: "WITHIN_BUDGET",
      remainingAfter: { amountMinor: 0, currency: "USD" },
    });
  });

  it("blocks one minor unit over and returns exact arithmetic", () => {
    expect(
      evaluateBudget({
        quoteTotal: { amountMinor: 9_501, currency: "USD" },
        remainingBudget: { amountMinor: 9_500, currency: "USD" },
      }),
    ).toEqual({
      status: "blocked",
      reasonCode: "INSUFFICIENT_LOCATION_BUDGET",
      shortfall: { amountMinor: 1, currency: "USD" },
    });
  });

  it("fails unknown on currency mismatch", () => {
    expect(
      evaluateBudget({
        quoteTotal: { amountMinor: 7_160, currency: "USD" },
        remainingBudget: { amountMinor: 9_500, currency: "EUR" },
      }),
    ).toEqual({
      status: "unknown",
      reasonCode: "CURRENCY_MISMATCH",
      quoteCurrency: "USD",
      budgetCurrency: "EUR",
    });
  });
});
