import { describe, expect, it, vi } from "vitest";

import type { RuntimeConfig } from "../../config/runtime";
import {
  BlockedLivePravaGateway,
  PravaGatewayError,
  ReplayPravaGateway,
  createPravaGateway,
} from "./gateway";
import { PravaSandboxGateway } from "./sandbox-gateway";

const replayConfig: RuntimeConfig = {
  mode: "replay",
  paymentsEnabled: false,
  sessionCreationEnabled: false,
  liveOrderEnabled: false,
  mcpContractConfirmed: false,
  mcpContractConfirmation: null,
};

const confirmedContractPayload = {
  supportCaseId: "SUP-0042",
  confirmationDate: "2026-07-30T12:00:00Z",
  executionChain:
    "shop_quote -> create_payment_session -> approval -> shop_checkout",
  localSchemaPrecedencePolicy: "prefer_public_documentation_over_local_schema",
  localSchemaContradictionResolution:
    "Support confirmed local schema metadata is stale for this environment",
  postQuoteTotalChangeBehavior:
    "re-quote required before checkout when total changes after approval",
  runtimeVersion: "mcp-2026-07-30-r3",
  timeoutRecoveryPolicy: "reconcile before retries",
};

describe("mode-separated Prava gateways", () => {
  it("uses a network-isolated gateway in replay", async () => {
    const gateway = createPravaGateway(replayConfig, {
      fetch: vi.fn<typeof fetch>(),
    });
    expect(gateway).toBeInstanceOf(ReplayPravaGateway);

    await expect(
      (gateway as ReplayPravaGateway).createSession(),
    ).rejects.toMatchObject({ code: "REPLAY_NETWORK_FORBIDDEN" });
  });

  it("requires a server-only test key for sandbox", () => {
    const config: RuntimeConfig = {
      mode: "sandbox",
      paymentsEnabled: true,
      sessionCreationEnabled: true,
      liveOrderEnabled: false,
      mcpContractConfirmed: false,
      mcpContractConfirmation: null,
    };

    expect(() => createPravaGateway(config)).toThrowError(
      expect.objectContaining<Partial<PravaGatewayError>>({
        code: "SANDBOX_KEY_REQUIRED",
      }),
    );
    expect(
      createPravaGateway(config, {
        sandboxSecretKey: "sk_test_redacted_for_unit_test",
        fetch: vi.fn<typeof fetch>(),
      }),
    ).toBeInstanceOf(PravaSandboxGateway);
  });

  it("never silently falls back while the live contract is unconfirmed", async () => {
    const gateway = createPravaGateway({
      mode: "live",
      paymentsEnabled: true,
      sessionCreationEnabled: true,
      liveOrderEnabled: true,
      mcpContractConfirmed: true,
      mcpContractConfirmation: confirmedContractPayload,
    });
    expect(gateway).toBeInstanceOf(BlockedLivePravaGateway);
    await expect(
      (gateway as BlockedLivePravaGateway).createSession(),
    ).rejects.toMatchObject({ code: "GATE_0_REQUIRED" });
  });

  it("requires explicit contract confirmation before live gateway construction", () => {
    expect(() =>
      createPravaGateway({
        mode: "live",
        paymentsEnabled: true,
        sessionCreationEnabled: true,
        liveOrderEnabled: true,
        mcpContractConfirmed: false,
        mcpContractConfirmation: null,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PravaGatewayError>>({
        code: "LIVE_MCP_CONTRACT_UNCONFIRMED",
      }),
    );
  });

  it("requires contract evidence payload, not just confirmation boolean", () => {
    expect(() =>
      createPravaGateway({
        mode: "live",
        paymentsEnabled: true,
        sessionCreationEnabled: true,
        liveOrderEnabled: true,
        mcpContractConfirmed: true,
        mcpContractConfirmation: null,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PravaGatewayError>>({
        code: "LIVE_MCP_CONTRACT_UNCONFIRMED",
      }),
    );
  });
});
