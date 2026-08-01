import { describe, expect, it } from "vitest";

import { RuntimeConfigurationError, parseRuntimeConfig } from "./runtime";

const confirmedContractPayload = JSON.stringify({
  supportCaseId: "SUP-0042",
  confirmationDate: "2026-07-30T12:00:00Z",
  runtimeVersion: "mcp-2026-07-30-r3",
  executionChain:
    "shop_quote -> create_payment_session -> approval -> shop_checkout",
  postQuoteTotalChangeBehavior:
    "re-quote required before checkout when total changes after approval",
  localSchemaPrecedencePolicy: "prefer_public_documentation_over_local_schema",
  localSchemaContradictionResolution:
    "Support confirmed local schema metadata is stale for this environment",
  timeoutRecoveryPolicy: "reconcile before retries",
});

describe("parseRuntimeConfig", () => {
  it("accepts replay only when every payment flag is false", () => {
    expect(
      parseRuntimeConfig({
        PRAVA_MODE: "replay",
        PAYMENTS_ENABLED: "false",
        ALLOW_PRAVA_SESSION_CREATION: "false",
        ALLOW_PRAVA_LIVE_ORDER: "false",
        PRAVA_MCP_CONTRACT_CONFIRMED: "false",
      }),
    ).toEqual({
      mode: "replay",
      paymentsEnabled: false,
      sessionCreationEnabled: false,
      liveOrderEnabled: false,
      mcpContractConfirmed: false,
      mcpContractConfirmation: null,
    });
  });

  it.each([
    ["missing mode", {}, "INVALID_MODE"],
    [
      "payment in replay",
      {
        PRAVA_MODE: "replay",
        PAYMENTS_ENABLED: "true",
        ALLOW_PRAVA_SESSION_CREATION: "false",
        ALLOW_PRAVA_LIVE_ORDER: "false",
      },
      "REPLAY_FLAGS_UNSAFE",
    ],
    [
      "incomplete sandbox",
      {
        PRAVA_MODE: "sandbox",
        PAYMENTS_ENABLED: "true",
        ALLOW_PRAVA_SESSION_CREATION: "false",
        ALLOW_PRAVA_LIVE_ORDER: "false",
      },
      "SANDBOX_FLAGS_INCOMPLETE",
    ],
    [
      "incomplete live",
      {
        PRAVA_MODE: "live",
        PAYMENTS_ENABLED: "true",
        ALLOW_PRAVA_SESSION_CREATION: "true",
        ALLOW_PRAVA_LIVE_ORDER: "false",
        PRAVA_MCP_CONTRACT_CONFIRMED: "true",
      },
      "LIVE_FLAGS_INCOMPLETE",
    ],
    [
      "live contract unconfirmed",
      {
        PRAVA_MODE: "live",
        PAYMENTS_ENABLED: "true",
        ALLOW_PRAVA_SESSION_CREATION: "true",
        ALLOW_PRAVA_LIVE_ORDER: "true",
        PRAVA_MCP_CONTRACT_CONFIRMED: "false",
      },
      "LIVE_MCP_CONTRACT_UNCONFIRMED",
    ],
    [
      "live contract confirmed but no evidence payload",
      {
        PRAVA_MODE: "live",
        PAYMENTS_ENABLED: "true",
        ALLOW_PRAVA_SESSION_CREATION: "true",
        ALLOW_PRAVA_LIVE_ORDER: "true",
        PRAVA_MCP_CONTRACT_CONFIRMED: "true",
      },
      "LIVE_MCP_CONTRACT_UNCONFIRMED",
    ],
  ] as const)("rejects %s", (_label, env, code) => {
    expect(() => parseRuntimeConfig(env)).toThrowError(
      expect.objectContaining<Partial<RuntimeConfigurationError>>({ code }),
    );
  });

  it("ignores malformed support-confirmation payload in replay mode", () => {
    expect(
      parseRuntimeConfig({
        PRAVA_MODE: "replay",
        PAYMENTS_ENABLED: "false",
        ALLOW_PRAVA_SESSION_CREATION: "false",
        ALLOW_PRAVA_LIVE_ORDER: "false",
        PRAVA_MCP_CONTRACT_CONFIRMED: "false",
        PRAVA_MCP_CONTRACT_CONFIRMATION: "{invalid-json",
      }),
    ).toEqual({
      mode: "replay",
      paymentsEnabled: false,
      sessionCreationEnabled: false,
      liveOrderEnabled: false,
      mcpContractConfirmed: false,
      mcpContractConfirmation: null,
    });
  });

  it("accepts live mode only when MCP contract is confirmed and evidence is provided", () => {
    expect(
      parseRuntimeConfig({
        PRAVA_MODE: "live",
        PAYMENTS_ENABLED: "true",
        ALLOW_PRAVA_SESSION_CREATION: "true",
        ALLOW_PRAVA_LIVE_ORDER: "true",
        PRAVA_MCP_CONTRACT_CONFIRMED: "true",
        PRAVA_MCP_CONTRACT_CONFIRMATION: confirmedContractPayload,
      }),
    ).toEqual({
      mode: "live",
      paymentsEnabled: true,
      sessionCreationEnabled: true,
      liveOrderEnabled: true,
      mcpContractConfirmed: true,
      mcpContractConfirmation: {
        supportCaseId: "SUP-0042",
        confirmationDate: "2026-07-30T12:00:00Z",
        runtimeVersion: "mcp-2026-07-30-r3",
        executionChain:
          "shop_quote -> create_payment_session -> approval -> shop_checkout",
        postQuoteTotalChangeBehavior:
          "re-quote required before checkout when total changes after approval",
        localSchemaPrecedencePolicy:
          "prefer_public_documentation_over_local_schema",
        localSchemaContradictionResolution:
          "Support confirmed local schema metadata is stale for this environment",
        timeoutRecoveryPolicy: "reconcile before retries",
      },
    });
  });

  it("rejects invalid contract-confirmation payload shape", () => {
    expect(() =>
      parseRuntimeConfig({
        PRAVA_MODE: "live",
        PAYMENTS_ENABLED: "true",
        ALLOW_PRAVA_SESSION_CREATION: "true",
        ALLOW_PRAVA_LIVE_ORDER: "true",
        PRAVA_MCP_CONTRACT_CONFIRMED: "true",
        PRAVA_MCP_CONTRACT_CONFIRMATION: JSON.stringify({
          supportCaseId: "SUP-0042",
          confirmationDate: "2026-07-30T12:00:00Z",
        }),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeConfigurationError>>({
        code: "LIVE_MCP_CONTRACT_UNCONFIRMED",
      }),
    );
  });

  it("rejects contract confirmation with placeholder ambiguity markers", () => {
    expect(() =>
      parseRuntimeConfig({
        PRAVA_MODE: "live",
        PAYMENTS_ENABLED: "true",
        ALLOW_PRAVA_SESSION_CREATION: "true",
        ALLOW_PRAVA_LIVE_ORDER: "true",
        PRAVA_MCP_CONTRACT_CONFIRMED: "true",
        PRAVA_MCP_CONTRACT_CONFIRMATION: JSON.stringify({
          supportCaseId: "SUP-0042",
          confirmationDate: "2026-07-30T12:00:00Z",
          runtimeVersion: "mcp-2026-07-30-unknown",
          executionChain:
            "shop_quote -> create_payment_session -> approval -> shop_checkout",
          postQuoteTotalChangeBehavior: "re-quote required before checkout",
          localSchemaPrecedencePolicy: "prefer public documentation",
          localSchemaContradictionResolution: "pending",
          timeoutRecoveryPolicy: "reconcile before retries",
        }),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeConfigurationError>>({
        code: "LIVE_MCP_CONTRACT_UNCONFIRMED",
      }),
    );
  });

  it("rejects non-definitive support case identifiers", () => {
    expect(() =>
      parseRuntimeConfig({
        PRAVA_MODE: "live",
        PAYMENTS_ENABLED: "true",
        ALLOW_PRAVA_SESSION_CREATION: "true",
        ALLOW_PRAVA_LIVE_ORDER: "true",
        PRAVA_MCP_CONTRACT_CONFIRMED: "true",
        PRAVA_MCP_CONTRACT_CONFIRMATION: JSON.stringify({
          supportCaseId: "tbd",
          confirmationDate: "2026-07-30T12:00:00Z",
          runtimeVersion: "mcp-2026-07-30-r3",
          executionChain:
            "shop_quote -> create_payment_session -> approval -> shop_checkout",
          postQuoteTotalChangeBehavior: "re-quote required before checkout",
          localSchemaPrecedencePolicy: "prefer public documentation",
          localSchemaContradictionResolution: "resolved in support response",
          timeoutRecoveryPolicy: "reconcile before retries",
        }),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeConfigurationError>>({
        code: "LIVE_MCP_CONTRACT_UNCONFIRMED",
      }),
    );
  });
});
