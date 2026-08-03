import { describe, expect, it } from "vitest";

import type { LiveRequestSnapshot } from "@/live/types";

import {
  canReconcileOutcomeReport,
  canReconcilePrava,
  getControlledSandboxReceipt,
  getPravaSessionCreationBlock,
  isUnsupportedPravaWebview,
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

describe("Prava browser boundary", () => {
  it.each([
    "Mozilla/5.0 Electron/31.0 Chrome/126.0",
    "Mozilla/5.0 Code/1.92 Electron/30.0",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A; wv)",
  ])("blocks embedded webviews before checkout: %s", (userAgent) => {
    expect(isUnsupportedPravaWebview(userAgent)).toBe(true);
  });

  it("allows a normal mobile Safari user agent to reach capability detection", () => {
    expect(
      isUnsupportedPravaWebview(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
  });
});

describe("Prava session creation circuit breaker", () => {
  it("blocks a second create action after an unknown remote outcome", () => {
    const request = {
      prava: null,
      pravaSessionOperation: {
        hasResponseId: false,
        httpStatus: null,
        status: "unknown",
        transportCode: "ETIMEDOUT",
        updatedAt: "2026-08-02T05:15:06.724Z",
        vendorCode: null,
      },
      state: "prava_session_unknown",
    } as LiveRequestSnapshot;

    expect(getPravaSessionCreationBlock(request)).toMatchObject({
      heading: "Prava session outcome unknown",
      message: expect.stringContaining("ETIMEDOUT"),
    });
  });

  it("allows an explicitly rejected operation to use the controlled retry path", () => {
    expect(
      getPravaSessionCreationBlock({
        prava: null,
        pravaSessionOperation: {
          hasResponseId: true,
          httpStatus: 400,
          status: "failed",
          transportCode: null,
          updatedAt: "2026-08-02T05:15:06.724Z",
          vendorCode: "VAL_2001",
        },
        state: "approved",
      } as LiveRequestSnapshot),
    ).toBeNull();
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

describe("controlled sandbox receipt", () => {
  const merchantAttempt = {
    adapter: "bones_coffee_shopify_gift_card_v1" as const,
    attemptedAt: "2026-08-02T03:00:00.000Z",
    checkoutUrlDigest: "a".repeat(64),
    declineCode: "CARD_DECLINED" as const,
    merchantHost: "www.bonescoffee.com" as const,
    noOrderCreated: true as const,
    outcome: "declined" as const,
    paymentSubmitted: true as const,
  };
  const report = {
    acknowledgedAt: "2026-08-02T03:00:02.000Z",
    txnStatus: "DECLINED" as const,
    visaConfirmation: "SUCCESS" as const,
  };

  it("does not call an acknowledged report complete before terminal polling", () => {
    const request = {
      approval: null,
      prava: { merchantAttempt, report, status: "awaiting_result" },
      state: "reported",
    } as LiveRequestSnapshot;

    expect(getControlledSandboxReceipt(request)).toMatchObject({
      controlStatus: "Terminal reconciliation pending",
      liveFunds: "None moved",
      merchantAttempt: "Submitted once",
      merchantOrder: "Not created",
      merchantOutcome: "Declined as expected",
      outcomeReport: "DECLINED acknowledged",
      pravaLifecycle: "Terminal reconciliation pending",
    });
  });

  it("marks only a fully reported terminal lifecycle complete", () => {
    const request = {
      approval: null,
      prava: { merchantAttempt, report, status: "failed" },
      state: "prava_terminal_observed",
    } as LiveRequestSnapshot;

    expect(getControlledSandboxReceipt(request)).toMatchObject({
      controlStatus: "Complete",
      pravaLifecycle: "Terminal failed",
    });
  });
});
