import { z } from "zod";

import { createMoney, moneySchema, type Money } from "./money";

export const budgetDecisionInputSchema = z
  .object({
    quoteTotal: moneySchema,
    remainingBudget: moneySchema,
  })
  .strict();

export type BudgetDecisionInput = z.input<typeof budgetDecisionInputSchema>;

export type BudgetDecision =
  | {
      status: "approved";
      reasonCode: "WITHIN_BUDGET";
      remainingAfter: Money;
    }
  | {
      status: "blocked";
      reasonCode: "INSUFFICIENT_LOCATION_BUDGET";
      shortfall: Money;
    }
  | {
      status: "unknown";
      reasonCode: "CURRENCY_MISMATCH";
      quoteCurrency: string;
      budgetCurrency: string;
    };

export function evaluateBudget(input: BudgetDecisionInput): BudgetDecision {
  const { quoteTotal, remainingBudget } =
    budgetDecisionInputSchema.parse(input);

  if (quoteTotal.currency !== remainingBudget.currency) {
    return {
      status: "unknown",
      reasonCode: "CURRENCY_MISMATCH",
      quoteCurrency: quoteTotal.currency,
      budgetCurrency: remainingBudget.currency,
    };
  }

  if (quoteTotal.amountMinor > remainingBudget.amountMinor) {
    return {
      status: "blocked",
      reasonCode: "INSUFFICIENT_LOCATION_BUDGET",
      shortfall: createMoney(
        quoteTotal.amountMinor - remainingBudget.amountMinor,
        quoteTotal.currency,
      ),
    };
  }

  return {
    status: "approved",
    reasonCode: "WITHIN_BUDGET",
    remainingAfter: createMoney(
      remainingBudget.amountMinor - quoteTotal.amountMinor,
      quoteTotal.currency,
    ),
  };
}
