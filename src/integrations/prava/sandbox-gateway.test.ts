import { describe, expect, it, vi } from "vitest";

import {
  classifyPravaSessionCreateFailure,
  PravaSandboxGateway,
  PravaSandboxGatewayError,
} from "./sandbox-gateway";

const sessionInput = {
  userId: "replay-user-001",
  userEmail: "maya@example.test",
  total: { amountMinor: 7_160, currency: "USD" },
  merchant: {
    name: "Replay Merchant",
    url: "https://merchant.example",
    countryCode: "US",
  },
  product: {
    description: "Everyday Crew Tee · Black / Small",
    productId: "replay-sku-001",
    unitPrice: { amountMinor: 3_000, currency: "USD" },
    quantity: 2,
  },
  externalOrderRef: "replay-request-site-b-001",
};

describe("PravaSandboxGateway", () => {
  it("classifies explicit vendor rejection separately from unknown create outcomes", () => {
    expect(
      classifyPravaSessionCreateFailure(
        new PravaSandboxGatewayError(
          "VENDOR_REQUEST_FAILED",
          "structured rejection",
          { status: 429, vendorCode: "TRIES_EXHAUSTED" },
        ),
      ),
    ).toBe("known_rejection");
    expect(
      classifyPravaSessionCreateFailure(
        new PravaSandboxGatewayError(
          "VENDOR_REQUEST_FAILED",
          "ambiguous server failure",
          { status: 503, vendorCode: "PROVISION_ERROR" },
        ),
      ),
    ).toBe("unknown_outcome");
    expect(
      classifyPravaSessionCreateFailure(
        new PravaSandboxGatewayError(
          "VENDOR_REQUEST_TIMEOUT",
          "response-free timeout",
        ),
      ),
    ).toBe("unknown_outcome");
    expect(
      classifyPravaSessionCreateFailure(
        new PravaSandboxGatewayError(
          "INVALID_VENDOR_RESPONSE",
          "unparseable success response",
        ),
      ),
    ).toBe("unknown_outcome");
    expect(classifyPravaSessionCreateFailure(new Error("unexpected"))).toBe(
      "unknown_outcome",
    );
  });

  it("uses only the official sandbox health endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          timestamp: "2026-08-01T02:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const gateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: fetchMock,
    });

    await expect(gateway.health()).resolves.toEqual({
      status: "ok",
      timestamp: "2026-08-01T02:00:00.000Z",
    });
    expect(gateway.lastResponseMeta).toMatchObject({
      operation: "health",
      responseId: null,
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sandbox.api.prava.space/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("creates a mechanics-only session and never returns its token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: "ses_test_official_example",
          session_token: "sensitive-session-jwt",
          iframe_url: "https://sandbox.collect.prava.space/session/example",
          order_id: "internal-order-example",
          expires_at: "2026-08-01T02:15:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const gateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: fetchMock,
    });

    const result = await gateway.createSession(sessionInput);

    expect(result).toEqual({
      mode: "sandbox",
      claim: "payment_mechanics_only",
      redactedSessionRef: expect.stringMatching(
        /^sandbox-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      ),
      approvalUrl: "https://sandbox.collect.prava.space/session/example",
      expiresAt: "2026-08-01T02:15:00.000Z",
      merchantOrderRef: null,
    });
    expect(JSON.stringify(result)).not.toContain("sensitive-session-jwt");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sandbox.api.prava.space/v1/sessions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"total_amount":"71.60"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sandbox.api.prava.space/v1/sessions",
      expect.objectContaining({
        body: expect.stringContaining('"product_id":"replay-sku-001"'),
      }),
    );
  });

  it("redacts credential-bearing payment results to status only", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "ses_test_official_example",
            session_token: "sensitive-session-jwt",
            iframe_url: "https://sandbox.collect.prava.space/session/example",
            order_id: "internal-order-example",
            expires_at: "2026-08-01T02:15:00.000Z",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "ses_test_official_example",
            order_id: null,
            status: "awaiting_result",
            transactions: [
              {
                txn_id: "txn_test_example",
                status: "awaiting_result",
                line_items: [
                  {
                    txn_ref_id: "txn_ref_example",
                    merchant_name: "Replay Merchant",
                    merchant_url: "https://merchant.example",
                    total_amount: "71.60",
                    status: "awaiting_result",
                    token: "4111111111111111",
                    dynamic_cvv: "123",
                    expiry_month: "12",
                    expiry_year: "2030",
                    products: [],
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const gateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: fetchMock,
    });
    const session = await gateway.createSession(sessionInput);
    const outcome = await gateway.getPaymentStatus(session.redactedSessionRef);

    expect(outcome).toEqual({
      mode: "sandbox",
      claim: "payment_mechanics_only",
      redactedSessionRef: session.redactedSessionRef,
      status: "awaiting_result",
      merchantOrderRef: null,
    });
    expect(JSON.stringify(outcome)).not.toMatch(
      /4111111111111111|dynamic_cvv|123|expiry_month/,
    );
  });

  it("revokes an active sealed session without exposing its session id", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "ses_test_revoke",
            session_token: "sensitive-session-jwt",
            iframe_url: "https://checkout.prava.space/s/ses_test_revoke",
            order_id: "internal-order-example",
            expires_at: "2026-08-01T02:15:00.000Z",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-response-id": "revoke-response-id",
          },
        }),
      );
    const gateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: fetchMock,
    });
    const session = await gateway.createSession(sessionInput);

    await expect(
      gateway.revokeSession(session.redactedSessionRef),
    ).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://sandbox.api.prava.space/v1/sessions/ses_test_revoke/revoke",
      expect.objectContaining({ method: "POST" }),
    );
    expect(gateway.lastResponseMeta).toMatchObject({
      operation: "revoke_session",
      responseId: "revoke-response-id",
      status: 200,
    });
  });

  it("keeps credentials server-side and reports the matching outcome", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "ses_test_report",
            session_token: "sensitive-session-jwt",
            iframe_url: "https://checkout.prava.space/s/ses_test_report",
            order_id: "internal-order-example",
            expires_at: "2026-08-01T02:15:00.000Z",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "ses_test_report",
            order_id: null,
            status: "awaiting_result",
            transactions: [
              {
                txn_id: "txn_test_report",
                status: "awaiting_result",
                line_items: [
                  {
                    txn_ref_id: "txn_ref_report",
                    status: "awaiting_result",
                    token: "4111111111111111",
                    dynamic_cvv: "123",
                    expiry_month: "12",
                    expiry_year: "2030",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "confirmed",
            txn_ref_id: "txn_ref_report",
            txn_status: "DECLINED",
            visa_confirmation: "SUCCESS",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const gateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: fetchMock,
    });
    const session = await gateway.createSession(sessionInput);
    const material = await gateway.getPaymentMaterial(
      session.redactedSessionRef,
    );

    expect(material).toMatchObject({
      status: "awaiting_result",
      txnRefId: "txn_ref_report",
      credentials: {
        token: "4111111111111111",
        dynamicCvv: "123",
        expiryMonth: "12",
        expiryYear: "2030",
      },
    });
    await expect(
      gateway.reportStatus(session.redactedSessionRef, {
        txnRefId: material.txnRefId!,
        txnStatus: "DECLINED",
        responseCode: "05",
      }),
    ).resolves.toEqual({
      status: "confirmed",
      txnRefId: "txn_ref_report",
      txnStatus: "DECLINED",
      visaConfirmation: "SUCCESS",
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://sandbox.api.prava.space/v1/sessions/ses_test_report/report-status",
      expect.objectContaining({
        body: expect.stringContaining('"txn_status":"DECLINED"'),
        method: "POST",
      }),
    );
  });

  it("rejects a report acknowledgement for a different merchant outcome", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "ses_test_mismatched_report",
            session_token: "sensitive-session-jwt",
            iframe_url:
              "https://checkout.prava.space/s/ses_test_mismatched_report",
            order_id: "internal-order-example",
            expires_at: "2026-08-01T02:15:00.000Z",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "confirmed",
            txn_ref_id: "txn_ref_report",
            txn_status: "APPROVED",
            visa_confirmation: "SUCCESS",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const gateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: fetchMock,
    });
    const session = await gateway.createSession(sessionInput);

    await expect(
      gateway.reportStatus(session.redactedSessionRef, {
        txnRefId: "txn_ref_report",
        txnStatus: "DECLINED",
      }),
    ).rejects.toMatchObject({ code: "INVALID_VENDOR_RESPONSE" });
  });

  it("rejects ambiguous payment material with multiple ready line items", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "ses_test_ambiguous",
            session_token: "sensitive-session-jwt",
            iframe_url: "https://checkout.prava.space/s/ses_test_ambiguous",
            order_id: "internal-order-example",
            expires_at: "2026-08-01T02:15:00.000Z",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "ses_test_ambiguous",
            order_id: "internal-order-example",
            status: "awaiting_result",
            transactions: ["first", "second"].map((suffix) => ({
              txn_id: `txn_${suffix}`,
              status: "awaiting_result",
              line_items: [
                {
                  txn_ref_id: `txn_ref_${suffix}`,
                  status: "awaiting_result",
                  token: `token_${suffix}`,
                  dynamic_cvv: "123",
                  expiry_month: "12",
                  expiry_year: "2030",
                },
              ],
            })),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const gateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: fetchMock,
    });
    const session = await gateway.createSession(sessionInput);

    await expect(
      gateway.getPaymentMaterial(session.redactedSessionRef),
    ).rejects.toMatchObject({ code: "INVALID_VENDOR_RESPONSE" });
  });

  it("can poll a sealed session reference after a gateway restart", async () => {
    const createFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: "ses_test_restart_safe",
          session_token: "sensitive-session-jwt",
          iframe_url: "https://sandbox.collect.prava.space/session/restart",
          order_id: "internal-order-example",
          expires_at: "2026-08-01T02:15:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const firstGateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: createFetch,
    });
    const session = await firstGateway.createSession(sessionInput);

    const pollFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: "ses_test_restart_safe",
          order_id: null,
          status: "completed",
          transactions: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const restartedGateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: pollFetch,
    });

    await expect(
      restartedGateway.getPaymentStatus(session.redactedSessionRef),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("preserves safe vendor diagnostics without exposing response bodies", async () => {
    const gateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "PROVISION_ERROR", message: "private detail" },
          }),
          {
            status: 503,
            headers: {
              "content-type": "application/json",
              "x-response-id": "safe-response-id",
            },
          },
        ),
      ),
    });

    await expect(gateway.health()).rejects.toMatchObject({
      code: "VENDOR_REQUEST_FAILED",
      details: {
        status: 503,
        responseId: "safe-response-id",
        vendorCode: "PROVISION_ERROR",
      },
    });
  });

  it("rejects live keys and nonconforming vendor payloads", async () => {
    expect(
      () =>
        new PravaSandboxGateway({
          secretKey: "sk_live_never_allowed_here",
          fetch,
        }),
    ).toThrowError(
      expect.objectContaining<Partial<PravaSandboxGatewayError>>({
        code: "INVALID_SANDBOX_KEY",
      }),
    );

    const gateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ status: "unexpected" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    await expect(gateway.health()).rejects.toMatchObject({
      code: "INVALID_VENDOR_RESPONSE",
    });
  });

  it("fails closed for currencies whose minor-unit exponent is not implemented", async () => {
    const gateway = new PravaSandboxGateway({
      secretKey: "sk_test_redacted_for_unit_test",
      fetch: vi.fn<typeof fetch>(),
    });

    await expect(
      gateway.createSession({
        ...sessionInput,
        total: { amountMinor: 7_160, currency: "JPY" },
        product: {
          ...sessionInput.product,
          unitPrice: { amountMinor: 3_000, currency: "JPY" },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_SESSION_INPUT" });
  });
});
