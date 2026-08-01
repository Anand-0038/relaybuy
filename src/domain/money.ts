import { z } from "zod";

export const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Currency must be a three-letter ISO 4217 code")
  .transform((currency) => currency.toUpperCase());

export const moneySchema = z
  .object({
    amountMinor: z.number().int().safe().nonnegative(),
    currency: currencySchema,
  })
  .strict();

export type Money = z.infer<typeof moneySchema>;

export type MoneyDomainErrorCode =
  | "INVALID_MONEY"
  | "CURRENCY_MISMATCH"
  | "INSUFFICIENT_FUNDS"
  | "AMOUNT_OVERFLOW";

export class MoneyDomainError extends Error {
  constructor(
    public readonly code: MoneyDomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MoneyDomainError";
  }
}

export function createMoney(amountMinor: number, currency: string): Money {
  const parsed = moneySchema.safeParse({ amountMinor, currency });

  if (!parsed.success) {
    throw new MoneyDomainError(
      "INVALID_MONEY",
      "Money must use non-negative integer minor units",
      {
        cause: parsed.error,
      },
    );
  }

  return parsed.data;
}

function requireSameCurrency(left: Money, right: Money): [Money, Money] {
  const parsedLeft = moneySchema.safeParse(left);
  const parsedRight = moneySchema.safeParse(right);

  if (!parsedLeft.success || !parsedRight.success) {
    throw new MoneyDomainError("INVALID_MONEY", "Invalid money value", {
      cause: parsedLeft.success ? parsedRight.error : parsedLeft.error,
    });
  }

  if (parsedLeft.data.currency !== parsedRight.data.currency) {
    throw new MoneyDomainError(
      "CURRENCY_MISMATCH",
      `Cannot combine ${parsedLeft.data.currency} and ${parsedRight.data.currency}`,
    );
  }

  return [parsedLeft.data, parsedRight.data];
}

export function addMoney(left: Money, right: Money): Money {
  const [validLeft, validRight] = requireSameCurrency(left, right);
  const amountMinor = validLeft.amountMinor + validRight.amountMinor;

  if (!Number.isSafeInteger(amountMinor)) {
    throw new MoneyDomainError(
      "AMOUNT_OVERFLOW",
      "Money addition exceeds safe integer range",
    );
  }

  return createMoney(amountMinor, validLeft.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  const [validLeft, validRight] = requireSameCurrency(left, right);

  if (validRight.amountMinor > validLeft.amountMinor) {
    throw new MoneyDomainError(
      "INSUFFICIENT_FUNDS",
      "Subtraction would produce a negative amount",
    );
  }

  return createMoney(
    validLeft.amountMinor - validRight.amountMinor,
    validLeft.currency,
  );
}
