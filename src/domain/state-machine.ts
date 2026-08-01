import { z } from "zod";

export const workflowStateSchema = z.enum([
  "RECEIVED",
  "NEEDS_CLARIFICATION",
  "IDENTIFIED",
  "PRODUCT_SELECTED",
  "VARIANT_APPROVED",
  "VARIANT_REJECTED",
  "QUOTED",
  "QUOTE_EXPIRED",
  "BUDGET_APPROVED",
  "BUDGET_BLOCKED",
  "APPROVAL_PENDING",
  "APPROVAL_EXPIRED",
  "PRAVA_APPROVED",
  "CHECKOUT_RUNNING",
  "ORDER_CONFIRMED",
  "PAYMENT_FAILED",
  "ORDER_UNVERIFIED",
]);

export type WorkflowState = z.infer<typeof workflowStateSchema>;

const nonEmptyId = z.string().trim().min(1);

export const workflowEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("REQUEST_CREATED") }).strict(),
  z
    .object({
      type: z.literal("CLARIFICATION_REQUIRED"),
      missingFields: z.array(nonEmptyId).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("EXTRACTION_RESOLVED"),
      extractionId: nonEmptyId,
    })
    .strict(),
  z
    .object({
      type: z.literal("PRODUCT_SELECTED"),
      productId: nonEmptyId,
    })
    .strict(),
  z
    .object({
      type: z.literal("VARIANT_APPROVED"),
      decisionId: nonEmptyId,
    })
    .strict(),
  z
    .object({
      type: z.literal("VARIANT_REJECTED"),
      decisionId: nonEmptyId,
    })
    .strict(),
  z.object({ type: z.literal("QUOTE_RECEIVED"), quoteId: nonEmptyId }).strict(),
  z.object({ type: z.literal("QUOTE_EXPIRED") }).strict(),
  z
    .object({
      type: z.literal("BUDGET_APPROVED"),
      decisionId: nonEmptyId,
    })
    .strict(),
  z
    .object({
      type: z.literal("BUDGET_BLOCKED"),
      decisionId: nonEmptyId,
    })
    .strict(),
  z
    .object({
      type: z.literal("APPROVAL_REQUESTED"),
      approvalId: nonEmptyId,
    })
    .strict(),
  z.object({ type: z.literal("APPROVAL_EXPIRED") }).strict(),
  z
    .object({
      type: z.literal("PRAVA_APPROVED"),
      sessionId: nonEmptyId,
    })
    .strict(),
  z
    .object({
      type: z.literal("CHECKOUT_STARTED"),
      attemptId: nonEmptyId,
    })
    .strict(),
  z
    .object({
      type: z.literal("ORDER_CONFIRMED"),
      orderId: nonEmptyId,
    })
    .strict(),
  z
    .object({
      type: z.literal("PAYMENT_FAILED"),
      failureCode: nonEmptyId,
    })
    .strict(),
  z
    .object({
      type: z.literal("OUTCOME_UNKNOWN"),
      attemptId: nonEmptyId,
    })
    .strict(),
]);

export type WorkflowEvent = z.infer<typeof workflowEventSchema>;

export const legalWorkflowTransitions = {
  RECEIVED: ["NEEDS_CLARIFICATION", "IDENTIFIED"],
  NEEDS_CLARIFICATION: ["IDENTIFIED"],
  IDENTIFIED: ["PRODUCT_SELECTED", "NEEDS_CLARIFICATION"],
  PRODUCT_SELECTED: [
    "VARIANT_APPROVED",
    "VARIANT_REJECTED",
    "NEEDS_CLARIFICATION",
  ],
  VARIANT_APPROVED: ["QUOTED"],
  VARIANT_REJECTED: ["PRODUCT_SELECTED"],
  QUOTED: ["BUDGET_APPROVED", "BUDGET_BLOCKED", "QUOTE_EXPIRED"],
  QUOTE_EXPIRED: ["QUOTED"],
  BUDGET_APPROVED: ["APPROVAL_PENDING", "QUOTE_EXPIRED"],
  BUDGET_BLOCKED: ["QUOTED"],
  APPROVAL_PENDING: ["PRAVA_APPROVED", "QUOTE_EXPIRED", "APPROVAL_EXPIRED"],
  APPROVAL_EXPIRED: ["APPROVAL_PENDING", "QUOTE_EXPIRED"],
  PRAVA_APPROVED: ["CHECKOUT_RUNNING", "QUOTE_EXPIRED"],
  CHECKOUT_RUNNING: ["ORDER_CONFIRMED", "PAYMENT_FAILED", "ORDER_UNVERIFIED"],
  ORDER_CONFIRMED: [],
  PAYMENT_FAILED: [],
  ORDER_UNVERIFIED: ["ORDER_CONFIRMED", "PAYMENT_FAILED"],
} as const satisfies Record<WorkflowState, readonly WorkflowState[]>;

const eventTargets: Record<WorkflowEvent["type"], WorkflowState> = {
  REQUEST_CREATED: "RECEIVED",
  CLARIFICATION_REQUIRED: "NEEDS_CLARIFICATION",
  EXTRACTION_RESOLVED: "IDENTIFIED",
  PRODUCT_SELECTED: "PRODUCT_SELECTED",
  VARIANT_APPROVED: "VARIANT_APPROVED",
  VARIANT_REJECTED: "VARIANT_REJECTED",
  QUOTE_RECEIVED: "QUOTED",
  QUOTE_EXPIRED: "QUOTE_EXPIRED",
  BUDGET_APPROVED: "BUDGET_APPROVED",
  BUDGET_BLOCKED: "BUDGET_BLOCKED",
  APPROVAL_REQUESTED: "APPROVAL_PENDING",
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  PRAVA_APPROVED: "PRAVA_APPROVED",
  CHECKOUT_STARTED: "CHECKOUT_RUNNING",
  ORDER_CONFIRMED: "ORDER_CONFIRMED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  OUTCOME_UNKNOWN: "ORDER_UNVERIFIED",
};

export class IllegalWorkflowTransitionError extends Error {
  public readonly code = "ILLEGAL_WORKFLOW_TRANSITION";

  constructor(
    public readonly currentState: WorkflowState,
    public readonly eventType: WorkflowEvent["type"],
    public readonly targetState: WorkflowState,
  ) {
    super(
      `Event ${eventType} cannot transition ${currentState} to ${targetState}`,
    );
    this.name = "IllegalWorkflowTransitionError";
  }
}

export function transitionWorkflow(
  currentState: unknown,
  event: unknown,
): WorkflowState {
  const validCurrentState = workflowStateSchema.parse(currentState);
  const validEvent = workflowEventSchema.parse(event);
  const targetState = eventTargets[validEvent.type];
  const allowedTargets: readonly WorkflowState[] =
    legalWorkflowTransitions[validCurrentState];

  if (!allowedTargets.includes(targetState)) {
    throw new IllegalWorkflowTransitionError(
      validCurrentState,
      validEvent.type,
      targetState,
    );
  }

  return targetState;
}
