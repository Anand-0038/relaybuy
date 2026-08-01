import type { RuntimeConfig } from "../../config/runtime";
import { PravaSandboxGateway } from "./sandbox-gateway";

export type PravaGatewayMode = "replay" | "sandbox" | "live";

export type MechanicsOnlySession = {
  mode: "sandbox";
  claim: "payment_mechanics_only";
  redactedSessionRef: string;
  approvalUrl: string;
  expiresAt: string;
  merchantOrderRef: null;
};

export type PravaGatewayErrorCode =
  | "REPLAY_NETWORK_FORBIDDEN"
  | "LIVE_MCP_CONTRACT_UNCONFIRMED"
  | "GATE_0_REQUIRED"
  | "SANDBOX_KEY_REQUIRED";

export class PravaGatewayError extends Error {
  constructor(
    public readonly code: PravaGatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PravaGatewayError";
  }
}

export class ReplayPravaGateway {
  readonly mode = "replay" as const;

  async createSession(): Promise<MechanicsOnlySession> {
    throw new PravaGatewayError(
      "REPLAY_NETWORK_FORBIDDEN",
      "Replay mode cannot create a Prava session",
    );
  }
}

export class BlockedLivePravaGateway {
  readonly mode = "live" as const;

  async createSession(): Promise<never> {
    throw new PravaGatewayError(
      "GATE_0_REQUIRED",
      "Live Prava MCP execution remains blocked until support@prava.space confirms runtime contracts",
    );
  }
}

export type ModeSeparatedPravaGateway =
  | ReplayPravaGateway
  | PravaSandboxGateway
  | BlockedLivePravaGateway;

export function createPravaGateway(
  config: RuntimeConfig,
  dependencies: {
    sandboxSecretKey?: string;
    fetch?: typeof fetch;
  } = {},
): ModeSeparatedPravaGateway {
  if (config.mode === "replay") {
    return new ReplayPravaGateway();
  }

  if (config.mode === "sandbox") {
    if (!dependencies.sandboxSecretKey) {
      throw new PravaGatewayError(
        "SANDBOX_KEY_REQUIRED",
        "Sandbox mode requires a server-only Prava test secret",
      );
    }
    return new PravaSandboxGateway({
      secretKey: dependencies.sandboxSecretKey,
      ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
    });
  }

  if (!config.mcpContractConfirmed || config.mcpContractConfirmation === null) {
    throw new PravaGatewayError(
      "LIVE_MCP_CONTRACT_UNCONFIRMED",
      "Live Prava MCP execution is blocked until support@prava.space confirms the runtime contract",
    );
  }

  return new BlockedLivePravaGateway();
}
