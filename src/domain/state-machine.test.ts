import { describe, expect, it } from "vitest";

import {
  IllegalWorkflowTransitionError,
  legalWorkflowTransitions,
  transitionWorkflow,
  type WorkflowEvent,
  type WorkflowState,
} from "./state-machine";

const eventForTarget: Record<WorkflowState, WorkflowEvent> = {
  RECEIVED: { type: "REQUEST_CREATED" },
  NEEDS_CLARIFICATION: {
    type: "CLARIFICATION_REQUIRED",
    missingFields: ["requestedOptions.size"],
  },
  IDENTIFIED: { type: "EXTRACTION_RESOLVED", extractionId: "extract-001" },
  PRODUCT_SELECTED: { type: "PRODUCT_SELECTED", productId: "product-001" },
  VARIANT_APPROVED: {
    type: "VARIANT_APPROVED",
    decisionId: "variant-decision-001",
  },
  VARIANT_REJECTED: {
    type: "VARIANT_REJECTED",
    decisionId: "variant-decision-002",
  },
  QUOTED: { type: "QUOTE_RECEIVED", quoteId: "quote-001" },
  QUOTE_EXPIRED: { type: "QUOTE_EXPIRED" },
  BUDGET_APPROVED: {
    type: "BUDGET_APPROVED",
    decisionId: "budget-decision-001",
  },
  BUDGET_BLOCKED: {
    type: "BUDGET_BLOCKED",
    decisionId: "budget-decision-002",
  },
  APPROVAL_PENDING: {
    type: "APPROVAL_REQUESTED",
    approvalId: "approval-001",
  },
  APPROVAL_EXPIRED: { type: "APPROVAL_EXPIRED" },
  PRAVA_APPROVED: {
    type: "PRAVA_APPROVED",
    sessionId: "session-redacted-001",
  },
  CHECKOUT_RUNNING: {
    type: "CHECKOUT_STARTED",
    attemptId: "checkout-attempt-001",
  },
  ORDER_CONFIRMED: {
    type: "ORDER_CONFIRMED",
    orderId: "order-redacted-001",
  },
  PAYMENT_FAILED: {
    type: "PAYMENT_FAILED",
    failureCode: "DECLINED",
  },
  ORDER_UNVERIFIED: {
    type: "OUTCOME_UNKNOWN",
    attemptId: "checkout-attempt-001",
  },
};

describe("transitionWorkflow", () => {
  it("accepts every documented legal transition", () => {
    for (const [currentState, targets] of Object.entries(
      legalWorkflowTransitions,
    ) as Array<[WorkflowState, readonly WorkflowState[]]>) {
      for (const target of targets) {
        expect(
          transitionWorkflow(currentState, eventForTarget[target]),
          `${currentState} -> ${target}`,
        ).toBe(target);
      }
    }
  });

  it.each([
    ["RECEIVED", "ORDER_CONFIRMED"],
    ["VARIANT_REJECTED", "PRAVA_APPROVED"],
    ["BUDGET_BLOCKED", "APPROVAL_PENDING"],
    ["QUOTE_EXPIRED", "PRAVA_APPROVED"],
    ["APPROVAL_EXPIRED", "PRAVA_APPROVED"],
    ["ORDER_CONFIRMED", "CHECKOUT_RUNNING"],
  ] as const)("rejects illegal %s -> %s", (currentState, target) => {
    expect(() =>
      transitionWorkflow(currentState, eventForTarget[target]),
    ).toThrowError(IllegalWorkflowTransitionError);
  });

  it("requires an official order reference for confirmation", () => {
    expect(() =>
      transitionWorkflow("CHECKOUT_RUNNING", {
        type: "ORDER_CONFIRMED",
        orderId: "",
      }),
    ).toThrow();
  });
});
