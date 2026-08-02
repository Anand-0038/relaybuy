import { describe, expect, it } from "vitest";

import {
  LiveWorkflowTransitionError,
  transitionLiveWorkflow,
} from "../state-machine";

describe("live request state machine", () => {
  it("requires evidence and policy before approval", () => {
    expect(transitionLiveWorkflow("draft", "extraction_succeeded")).toBe(
      "extracted",
    );
    expect(transitionLiveWorkflow("extracted", "evidence_resolved")).toBe(
      "evidence_resolved",
    );
    expect(
      transitionLiveWorkflow("evidence_resolved", "approval_requested"),
    ).toBe("approval_pending");
  });

  it("does not allow approval directly from draft", () => {
    expect(() => transitionLiveWorkflow("draft", "approval_consumed")).toThrow(
      LiveWorkflowTransitionError,
    );
  });

  it("locks an approved artifact when Prava session creation is ambiguous", () => {
    expect(transitionLiveWorkflow("approved", "prava_session_unknown")).toBe(
      "prava_session_unknown",
    );
    expect(() =>
      transitionLiveWorkflow("prava_session_unknown", "prava_session_created"),
    ).toThrow(LiveWorkflowTransitionError);
  });

  it("reaches reported only after the merchant outcome report is acknowledged", () => {
    expect(transitionLiveWorkflow("reporting_outcome", "prava_reported")).toBe(
      "reported",
    );
  });

  it("records an observed Prava terminal state without calling it reported", () => {
    expect(
      transitionLiveWorkflow("prava_pending", "prava_terminal_observed"),
    ).toBe("prava_terminal_observed");
    expect(
      transitionLiveWorkflow("reporting_outcome", "prava_terminal_observed"),
    ).toBe("prava_terminal_observed");
    expect(
      transitionLiveWorkflow("report_failed", "prava_terminal_observed"),
    ).toBe("prava_terminal_observed");
  });

  it("moves an abandoned checkout lease to manual review", () => {
    expect(
      transitionLiveWorkflow(
        "merchant_checkout_running",
        "credential_window_lost",
      ),
    ).toBe("credential_window_lost");
  });
});
