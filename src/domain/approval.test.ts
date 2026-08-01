import { describe, expect, it } from "vitest";

import {
  ApprovalTokenError,
  InMemoryApprovalTokenStore,
  issueApprovalToken,
  validateApprovalToken,
} from "./approval";
import { createMoney } from "./money";

const issuedAt = new Date("2026-07-26T12:00:00.000Z");
const quoteBinding = {
  quoteId: "quote-1",
  amount: createMoney(8_450, "USD"),
  merchantId: "merchant-1",
  variantId: "tze-231-black",
};
const validationContext = {
  requestId: "request-1",
  managerId: "manager-1",
  ...quoteBinding,
};

function issueTestApproval() {
  return issueApprovalToken({
    ...validationContext,
    issuedAt,
    expiresAt: new Date("2026-07-26T12:10:00.000Z"),
  });
}

describe("approval tokens", () => {
  it("issues an opaque 256-bit token while storing only its hash", () => {
    const approval = issueTestApproval();

    expect(approval.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(approval.record.tokenHash).not.toContain(approval.token);
    expect(approval.record.usedAt).toBeNull();
  });

  it("rejects a TTL longer than ten minutes", () => {
    expect(() =>
      issueApprovalToken({
        requestId: "request-1",
        ...quoteBinding,
        managerId: "manager-1",
        issuedAt,
        expiresAt: new Date("2026-07-26T12:10:00.001Z"),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_APPROVAL" }));
  });

  it("expires at the exact expiry instant", () => {
    const approval = issueTestApproval();

    expect(() =>
      validateApprovalToken(
        approval.record,
        approval.token,
        validationContext,
        new Date("2026-07-26T12:10:00.000Z"),
      ),
    ).toThrowError(expect.objectContaining({ code: "TOKEN_EXPIRED" }));
  });

  it.each([
    ["requestId", { ...validationContext, requestId: "request-2" }],
    ["managerId", { ...validationContext, managerId: "manager-2" }],
    ["quoteId", { ...validationContext, quoteId: "quote-2" }],
    ["amount", { ...validationContext, amount: createMoney(8_451, "USD") }],
    ["merchantId", { ...validationContext, merchantId: "merchant-2" }],
    ["variantId", { ...validationContext, variantId: "tze-231-blue" }],
  ])(
    "invalidates approval when current %s changes",
    (_field, currentContext) => {
      const approval = issueTestApproval();

      expect(() =>
        validateApprovalToken(
          approval.record,
          approval.token,
          currentContext,
          new Date("2026-07-26T12:05:00.000Z"),
        ),
      ).toThrowError(
        expect.objectContaining({ code: "TOKEN_BINDING_MISMATCH" }),
      );
    },
  );

  it("rejects a valid token before its issuance time", () => {
    const approval = issueTestApproval();

    expect(() =>
      validateApprovalToken(
        approval.record,
        approval.token,
        validationContext,
        new Date("2026-07-26T11:59:59.999Z"),
      ),
    ).toThrowError(expect.objectContaining({ code: "TOKEN_NOT_YET_VALID" }));
  });

  it("atomically permits only one consume of the stored token", async () => {
    const approval = issueTestApproval();
    const store = new InMemoryApprovalTokenStore();
    store.add(approval.record);

    const attempts = await Promise.allSettled([
      store.consume(
        approval.token,
        validationContext,
        new Date("2026-07-26T12:05:00.000Z"),
      ),
      store.consume(
        approval.token,
        validationContext,
        new Date("2026-07-26T12:05:00.000Z"),
      ),
    ]);

    expect(
      attempts.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(attempts.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ code: "TOKEN_USED" }),
    });
  });

  it("rejects an incorrect token", () => {
    const approval = issueTestApproval();

    expect(() =>
      validateApprovalToken(
        approval.record,
        "wrong-token",
        validationContext,
        new Date("2026-07-26T12:05:00.000Z"),
      ),
    ).toThrowError(expect.objectContaining({ code: "TOKEN_INVALID" }));
  });

  it("uses a typed approval error for replays", async () => {
    const approval = issueTestApproval();
    const store = new InMemoryApprovalTokenStore();
    store.add(approval.record);
    await store.consume(
      approval.token,
      validationContext,
      new Date("2026-07-26T12:05:00.000Z"),
    );

    await expect(
      store.consume(
        approval.token,
        validationContext,
        new Date("2026-07-26T12:06:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(ApprovalTokenError);
  });
});
