import type { LiveRequestState } from "./types";

export type LiveWorkflowEvent =
  | "extraction_succeeded"
  | "clarification_requested"
  | "clarification_answered"
  | "evidence_resolved"
  | "policy_refused"
  | "approval_requested"
  | "approval_consumed"
  | "approval_rejected"
  | "prava_session_created"
  | "prava_credentials_issued"
  | "prava_session_failed"
  | "prava_terminal_observed"
  | "prava_session_revoked"
  | "merchant_checkout_started"
  | "merchant_checkout_declined"
  | "merchant_checkout_blocked"
  | "credential_window_lost"
  | "prava_report_started"
  | "prava_reported"
  | "prava_report_failed"
  | "prava_report_unknown"
  | "approval_invalidated"
  | "request_reopened"
  | "request_expired"
  | "workflow_failed";

const transitions: Record<
  LiveRequestState,
  Partial<Record<LiveWorkflowEvent, LiveRequestState>>
> = {
  approval_pending: {
    approval_consumed: "approved",
    approval_invalidated: "approval_invalidated",
    approval_rejected: "rejected",
    request_expired: "expired",
    workflow_failed: "failed",
  },
  approved: {
    approval_invalidated: "approval_invalidated",
    prava_session_created: "prava_pending",
    request_expired: "expired",
    workflow_failed: "failed",
  },
  credentials_issued: {
    merchant_checkout_started: "merchant_checkout_running",
    prava_terminal_observed: "prava_terminal_observed",
    prava_session_failed: "failed",
    prava_session_revoked: "canceled",
    request_expired: "expired",
  },
  draft: {
    clarification_requested: "clarification_required",
    extraction_succeeded: "extracted",
    request_expired: "expired",
    workflow_failed: "failed",
  },
  clarification_required: {
    clarification_answered: "draft",
    request_expired: "expired",
  },
  evidence_resolved: {
    approval_requested: "approval_pending",
    policy_refused: "refused",
    request_expired: "expired",
    workflow_failed: "failed",
  },
  expired: {},
  extracted: {
    evidence_resolved: "evidence_resolved",
    request_expired: "expired",
    workflow_failed: "failed",
  },
  failed: {},
  merchant_checkout_running: {
    credential_window_lost: "credential_window_lost",
    merchant_checkout_blocked: "merchant_blocked",
    merchant_checkout_declined: "merchant_declined_test_card",
    workflow_failed: "failed",
  },
  merchant_declined_test_card: {
    prava_report_started: "reporting_outcome",
    workflow_failed: "failed",
  },
  prava_pending: {
    prava_credentials_issued: "credentials_issued",
    prava_session_failed: "failed",
    prava_session_revoked: "canceled",
    prava_terminal_observed: "prava_terminal_observed",
    request_expired: "expired",
    workflow_failed: "failed",
  },
  refused: {
    request_reopened: "draft",
    request_expired: "expired",
  },
  rejected: {
    request_reopened: "draft",
    request_expired: "expired",
  },
  reported: {},
  reporting_outcome: {
    prava_report_failed: "report_failed",
    prava_report_unknown: "report_unknown",
    prava_reported: "reported",
    prava_terminal_observed: "prava_terminal_observed",
  },
  report_failed: {
    prava_terminal_observed: "prava_terminal_observed",
  },
  report_unknown: {
    prava_terminal_observed: "prava_terminal_observed",
  },
  approval_invalidated: {},
  canceled: {},
  credential_window_lost: {},
  merchant_blocked: {},
  prava_terminal_observed: {},
};

export class LiveWorkflowTransitionError extends Error {
  constructor(
    public readonly state: LiveRequestState,
    public readonly event: LiveWorkflowEvent,
  ) {
    super(`Event ${event} is not legal from state ${state}`);
    this.name = "LiveWorkflowTransitionError";
  }
}

export function transitionLiveWorkflow(
  state: LiveRequestState,
  event: LiveWorkflowEvent,
): LiveRequestState {
  const next = transitions[state][event];
  if (!next) {
    throw new LiveWorkflowTransitionError(state, event);
  }
  return next;
}
