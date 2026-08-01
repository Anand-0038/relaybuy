import { describe, expect, it } from "vitest";

import {
  addMoney,
  createMoney,
  MoneyDomainError,
  subtractMoney,
} from "./money";

describe("money", () => {
  it("rejects floating-point minor units", () => {
    expect(() => createMoney(4_200.5, "USD")).toThrow(MoneyDomainError);
  });

  it("normalizes currency and adds integer minor units", () => {
    expect(
      addMoney(createMoney(4_200, "usd"), createMoney(850, "USD")),
    ).toEqual({
      amountMinor: 5_050,
      currency: "USD",
    });
  });

  it("rejects mixed currencies", () => {
    expect(() =>
      addMoney(createMoney(100, "USD"), createMoney(100, "EUR")),
    ).toThrowError(expect.objectContaining({ code: "CURRENCY_MISMATCH" }));
  });

  it("rejects subtraction below zero", () => {
    expect(() =>
      subtractMoney(createMoney(99, "USD"), createMoney(100, "USD")),
    ).toThrowError(expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }));
  });
});
