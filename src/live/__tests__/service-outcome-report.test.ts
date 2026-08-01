import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveRequestSnapshot } from "../types";

const mocks = vi.hoisted(() => ({
  beginOutcomeReport: vi.fn(),
  completeOutcomeReport: vi.fn(),
  failOutcomeReport: vi.fn(),
  getById: vi.fn(),
  getPaymentMaterial: vi.fn(),
  reportStatus: vi.fn(),
  savePravaReconciliation: vi.fn(),
}));

vi.mock("@/config/runtime", () => ({
  parseRuntimeConfig: () => ({
    liveOrderEnabled: false,
    mode: "sandbox",
    paymentsEnabled: true,
    sessionCreationEnabled: true,
  }),
  RuntimeConfigurationError: class RuntimeConfigurationError extends Error {},
}));

vi.mock("@/integrations/prava/sandbox-gateway", () => ({
  classifyPravaSessionCreateFailure: () => "unknown_outcome",
  PravaSandboxGateway: class PravaSandboxGateway {
    getPaymentMaterial = mocks.getPaymentMaterial;
    reportStatus = mocks.reportStatus;
  },
  PravaSandboxGatewayError: class PravaSandboxGatewayError extends Error {},
}));

vi.mock("@/live/env", () => ({
  getLiveEnvironment: () => ({
    PRAVA_MERCHANT_SECRET_KEY: "sk_test_redacted_for_unit_test",
  }),
}));

vi.mock("@/live/repository", () => ({
  LiveRepositoryError: class LiveRepositoryError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  LiveRequestRepository: class LiveRequestRepository {
    beginOutcomeReport = mocks.beginOutcomeReport;
    completeOutcomeReport = mocks.completeOutcomeReport;
    failOutcomeReport = mocks.failOutcomeReport;
    getById = mocks.getById;
    savePravaReconciliation = mocks.savePravaReconciliation;
  },
}));

import { executeLiveMerchantCheckout } from "../service";

const requestId = "00000000-0000-4000-8000-000000000001";
const now = "2026-07-31T18:00:00.000Z";
const merchantDeclined = {
  id: requestId,
  prava: {
    credentialsReady: false,
    merchantAttempt: {
      adapter: "bones_coffee_shopify_gift_card_v1",
      attemptedAt: now,
      checkoutUrlDigest: "a".repeat(64),
      declineCode: "CARD_DECLINED",
      merchantHost: "www.bonescoffee.com",
      noOrderCreated: true,
      outcome: "declined",
      paymentSubmitted: true,
    },
    redactedSessionRef: "sandbox-v1.redacted-reference-for-unit-test",
    status: "awaiting_result",
    txnRefId: "txn-ref-1",
  },
  state: "merchant_declined_test_card",
} as LiveRequestSnapshot;
const reporting = {
  ...merchantDeclined,
  state: "reporting_outcome",
} as LiveRequestSnapshot;
const reported = {
  ...merchantDeclined,
  prava: {
    ...merchantDeclined.prava!,
    report: {
      acknowledgedAt: now,
      txnStatus: "DECLINED",
      visaConfirmation: "SUCCESS",
    },
  },
  state: "reported",
} as LiveRequestSnapshot;
const terminalObserved = {
  ...reporting,
  prava: {
    ...reporting.prava!,
    status: "failed",
  },
  state: "prava_terminal_observed",
} as LiveRequestSnapshot;

describe("outcome report persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getById.mockResolvedValue(merchantDeclined);
    mocks.beginOutcomeReport.mockResolvedValue(reporting);
    mocks.reportStatus.mockResolvedValue({
      status: "confirmed",
      txnRefId: "txn-ref-1",
      txnStatus: "DECLINED",
      visaConfirmation: "SUCCESS",
    });
    mocks.completeOutcomeReport.mockResolvedValue(reported);
    mocks.failOutcomeReport.mockResolvedValue(undefined);
  });

  it("keeps a matched acknowledgement durable when the terminal poll fails", async () => {
    mocks.getPaymentMaterial.mockRejectedValue(
      new Error("transient payment-result failure"),
    );

    await expect(executeLiveMerchantCheckout(requestId)).resolves.toBe(
      reported,
    );
    expect(mocks.completeOutcomeReport).toHaveBeenCalledOnce();
    expect(mocks.failOutcomeReport).not.toHaveBeenCalled();
    expect(
      mocks.completeOutcomeReport.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.getPaymentMaterial.mock.invocationCallOrder[0]!);
  });

  it("does not re-report after recovery observes a terminal failed status", async () => {
    mocks.getById.mockResolvedValue(reporting);
    mocks.getPaymentMaterial.mockResolvedValue({
      credentials: null,
      status: "failed",
      txnRefId: "txn-ref-1",
    });
    mocks.savePravaReconciliation.mockResolvedValue(terminalObserved);

    await expect(executeLiveMerchantCheckout(requestId)).resolves.toBe(
      terminalObserved,
    );
    expect(mocks.savePravaReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ event: "prava_terminal_observed" }),
    );
    expect(mocks.reportStatus).not.toHaveBeenCalled();
    expect(mocks.failOutcomeReport).not.toHaveBeenCalled();
  });

  it("does not make a lost report acknowledgement retryable", async () => {
    mocks.reportStatus.mockRejectedValueOnce(new Error("response lost"));

    await expect(executeLiveMerchantCheckout(requestId)).rejects.toThrow(
      "unknown remote outcome",
    );
    expect(mocks.reportStatus).toHaveBeenCalledOnce();
    expect(mocks.failOutcomeReport).not.toHaveBeenCalled();

    mocks.getById.mockResolvedValue(reporting);
    mocks.getPaymentMaterial.mockResolvedValue({
      credentials: null,
      status: "awaiting_result",
      txnRefId: "txn-ref-1",
    });

    await expect(executeLiveMerchantCheckout(requestId)).rejects.toThrow(
      "must be reconciled",
    );
    expect(mocks.reportStatus).toHaveBeenCalledOnce();
    expect(mocks.failOutcomeReport).not.toHaveBeenCalled();
  });
});
