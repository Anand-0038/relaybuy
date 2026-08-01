import { describe, expect, it } from "vitest";

import {
  createMerchantAttemptDigest,
  createOutcomeReportIdempotencyKey,
  createSessionIdempotencyKey,
} from "../operations";

describe("durable operation identifiers", () => {
  it("uses the immutable approval hash as a stable session operation key", () => {
    expect(createSessionIdempotencyKey("a".repeat(64))).toBe(
      createSessionIdempotencyKey("a".repeat(64)),
    );
    expect(createSessionIdempotencyKey("a".repeat(64))).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it("binds an outcome report to both the transaction and merchant attempt", () => {
    const first = createOutcomeReportIdempotencyKey("txn-1", "b".repeat(64));
    expect(first).toBe(
      createOutcomeReportIdempotencyKey("txn-1", "b".repeat(64)),
    );
    expect(first).not.toBe(
      createOutcomeReportIdempotencyKey("txn-2", "b".repeat(64)),
    );
    expect(first).not.toBe(
      createOutcomeReportIdempotencyKey("txn-1", "c".repeat(64)),
    );
  });

  it("creates a stable digest for the normalized merchant attempt", () => {
    expect(
      createMerchantAttemptDigest({
        outcome: "declined",
        paymentSubmitted: true,
      }),
    ).toBe(
      createMerchantAttemptDigest({
        outcome: "declined",
        paymentSubmitted: true,
      }),
    );
  });
});
