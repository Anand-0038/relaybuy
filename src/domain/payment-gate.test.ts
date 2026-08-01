import { describe, expect, it } from "vitest";

import {
  evaluatePaymentGate,
  type PaymentGateInput,
  type PaymentGateReason,
} from "./payment-gate";

const approvedInput: PaymentGateInput = {
  mode: "sandbox",
  paymentsEnabled: true,
  sessionCreationEnabled: true,
  liveOrderEnabled: false,
  variantDecision: "approved",
  budgetDecision: "approved",
  quoteStatus: "fresh",
  approvalStatus: "current",
  approvedPayloadHash: "approval-payload-sha256",
  currentPayloadHash: "approval-payload-sha256",
  idempotencyKey: "payment-session-request-001",
};

const failureCases: Array<{
  reason: PaymentGateReason;
  patch: Partial<PaymentGateInput>;
}> = [
  { reason: "REPLAY_MODE", patch: { mode: "replay" } },
  { reason: "PAYMENTS_DISABLED", patch: { paymentsEnabled: false } },
  {
    reason: "SESSION_CREATION_DISABLED",
    patch: { sessionCreationEnabled: false },
  },
  {
    reason: "LIVE_ORDER_DISABLED",
    patch: { mode: "live", liveOrderEnabled: false },
  },
  {
    reason: "VARIANT_NOT_APPROVED",
    patch: { variantDecision: "rejected" },
  },
  {
    reason: "BUDGET_NOT_APPROVED",
    patch: { budgetDecision: "blocked" },
  },
  { reason: "QUOTE_NOT_FRESH", patch: { quoteStatus: "expired" } },
  {
    reason: "HUMAN_CONFIRMATION_NOT_CURRENT",
    patch: { approvalStatus: "expired" },
  },
  {
    reason: "APPROVED_PAYLOAD_CHANGED",
    patch: { currentPayloadHash: "different-payload-sha256" },
  },
  {
    reason: "IDEMPOTENCY_KEY_MISSING",
    patch: { idempotencyKey: null },
  },
];

describe("evaluatePaymentGate", () => {
  it.each(failureCases)("rejects $reason", ({ reason, patch }) => {
    expect(evaluatePaymentGate({ ...approvedInput, ...patch })).toEqual({
      status: "rejected",
      reason,
    });
  });

  it("uses deterministic first-failure precedence", () => {
    expect(
      evaluatePaymentGate({
        ...approvedInput,
        mode: "replay",
        paymentsEnabled: false,
        variantDecision: "unknown",
      }),
    ).toEqual({
      status: "rejected",
      reason: "REPLAY_MODE",
    });
  });

  it("approves sandbox session mechanics", () => {
    expect(evaluatePaymentGate(approvedInput)).toEqual({
      status: "approved",
      mode: "sandbox",
      approvedPayloadHash: "approval-payload-sha256",
      idempotencyKey: "payment-session-request-001",
    });
  });

  it("approves a live payload only when live ordering is enabled", () => {
    expect(
      evaluatePaymentGate({
        ...approvedInput,
        mode: "live",
        liveOrderEnabled: true,
      }),
    ).toMatchObject({
      status: "approved",
      mode: "live",
    });
  });
});
