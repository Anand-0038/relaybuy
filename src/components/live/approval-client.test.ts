import { describe, expect, it } from "vitest";

import type { LiveRequestSnapshot } from "@/live/types";

import {
  canReconcileOutcomeReport,
  canReconcilePrava,
} from "./approval-client";

function requestWithPrava(
  state: LiveRequestSnapshot["state"],
  status: NonNullable<LiveRequestSnapshot["prava"]>["status"],
): LiveRequestSnapshot {
  return { prava: { status }, state } as LiveRequestSnapshot;
}

describe("Prava reconciliation availability", () => {
  it("allows a reported outcome with a non-terminal vendor status to be polled", () => {
    expect(
      canReconcilePrava(requestWithPrava("reported", "awaiting_result")),
    ).toBe(true);
  });

  it("does not offer reconciliation after the reported status is terminal", () => {
    expect(canReconcilePrava(requestWithPrava("reported", "completed"))).toBe(
      false,
    );
    expect(canReconcilePrava(requestWithPrava("reported", "failed"))).toBe(
      false,
    );
  });
});

describe("outcome report recovery availability", () => {
  it("offers recovery when a report was interrupted in flight", () => {
    expect(
      canReconcileOutcomeReport(
        requestWithPrava("reporting_outcome", "awaiting_result"),
      ),
    ).toBe(true);
  });

  it("does not offer report recovery after acknowledgement", () => {
    expect(
      canReconcileOutcomeReport(
        requestWithPrava("reported", "awaiting_result"),
      ),
    ).toBe(false);
  });
});
