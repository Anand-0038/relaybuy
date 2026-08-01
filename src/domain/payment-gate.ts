import { z } from "zod";

export const paymentGateInputSchema = z
  .object({
    mode: z.enum(["replay", "sandbox", "live"]),
    paymentsEnabled: z.boolean(),
    sessionCreationEnabled: z.boolean(),
    liveOrderEnabled: z.boolean(),
    variantDecision: z.enum(["approved", "rejected", "unknown"]),
    budgetDecision: z.enum(["approved", "blocked", "unknown"]),
    quoteStatus: z.enum(["fresh", "expired", "missing"]),
    approvalStatus: z.enum(["current", "expired", "missing"]),
    approvedPayloadHash: z.string().trim().min(1).nullable(),
    currentPayloadHash: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).nullable(),
  })
  .strict();

export type PaymentGateInput = z.input<typeof paymentGateInputSchema>;

export type PaymentGateReason =
  | "REPLAY_MODE"
  | "PAYMENTS_DISABLED"
  | "SESSION_CREATION_DISABLED"
  | "LIVE_ORDER_DISABLED"
  | "VARIANT_NOT_APPROVED"
  | "BUDGET_NOT_APPROVED"
  | "QUOTE_NOT_FRESH"
  | "HUMAN_CONFIRMATION_NOT_CURRENT"
  | "APPROVED_PAYLOAD_CHANGED"
  | "IDEMPOTENCY_KEY_MISSING";

export type PaymentGateDecision =
  | {
      status: "rejected";
      reason: PaymentGateReason;
    }
  | {
      status: "approved";
      mode: "sandbox" | "live";
      approvedPayloadHash: string;
      idempotencyKey: string;
    };

export function evaluatePaymentGate(
  input: PaymentGateInput,
): PaymentGateDecision {
  const validInput = paymentGateInputSchema.parse(input);

  if (validInput.mode === "replay") {
    return { status: "rejected", reason: "REPLAY_MODE" };
  }

  if (!validInput.paymentsEnabled) {
    return { status: "rejected", reason: "PAYMENTS_DISABLED" };
  }

  if (!validInput.sessionCreationEnabled) {
    return { status: "rejected", reason: "SESSION_CREATION_DISABLED" };
  }

  if (validInput.mode === "live" && !validInput.liveOrderEnabled) {
    return { status: "rejected", reason: "LIVE_ORDER_DISABLED" };
  }

  if (validInput.variantDecision !== "approved") {
    return { status: "rejected", reason: "VARIANT_NOT_APPROVED" };
  }

  if (validInput.budgetDecision !== "approved") {
    return { status: "rejected", reason: "BUDGET_NOT_APPROVED" };
  }

  if (validInput.quoteStatus !== "fresh") {
    return { status: "rejected", reason: "QUOTE_NOT_FRESH" };
  }

  if (validInput.approvalStatus !== "current") {
    return {
      status: "rejected",
      reason: "HUMAN_CONFIRMATION_NOT_CURRENT",
    };
  }

  if (
    validInput.approvedPayloadHash === null ||
    validInput.approvedPayloadHash !== validInput.currentPayloadHash
  ) {
    return { status: "rejected", reason: "APPROVED_PAYLOAD_CHANGED" };
  }

  if (validInput.idempotencyKey === null) {
    return { status: "rejected", reason: "IDEMPOTENCY_KEY_MISSING" };
  }

  return {
    status: "approved",
    mode: validInput.mode,
    approvedPayloadHash: validInput.approvedPayloadHash,
    idempotencyKey: validInput.idempotencyKey,
  };
}
