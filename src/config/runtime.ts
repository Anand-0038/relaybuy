import { z } from "zod";

const runtimeModeSchema = z.enum(["replay", "sandbox", "live"]);
const booleanFlagSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
const contractDateSchema = z.iso.datetime({ offset: true });
const ambiguousResolutionPattern =
  /(?:^|[^a-z0-9])(?:unknown|tbd|todo|to be determined|to-do|unresolved|placeholder|not yet|pending confirmation|not confirmed|n\/a|na)(?:$|[^a-z0-9])/i;

function isAmbiguousContractText(value: string): boolean {
  return ambiguousResolutionPattern.test(value.toLowerCase());
}

const definitiveTextField = (fieldName: string) =>
  z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => !isAmbiguousContractText(value),
      `${fieldName} must be a definitive answer from support@prava.space, not a placeholder`,
    );

export const contractConfirmationSchema = z
  .object({
    supportCaseId: z
      .string()
      .trim()
      .min(4)
      .refine(
        (value) => /^[a-zA-Z0-9._-]+$/.test(value),
        "supportCaseId must be a structured support identifier",
      )
      .refine(
        (value) => !isAmbiguousContractText(value),
        "supportCaseId must be a definitive answer from support@prava.space, not a placeholder",
      ),
    confirmationDate: contractDateSchema,
    runtimeVersion: definitiveTextField("runtimeVersion").regex(
      /^[a-zA-Z0-9._-]+$/,
      "runtimeVersion must be a non-ambiguous MCP runtime version identifier",
    ),
    executionChain: definitiveTextField("executionChain"),
    postQuoteTotalChangeBehavior: definitiveTextField(
      "postQuoteTotalChangeBehavior",
    ),
    localSchemaPrecedencePolicy: definitiveTextField(
      "localSchemaPrecedencePolicy",
    ),
    localSchemaContradictionResolution: definitiveTextField(
      "localSchemaContradictionResolution",
    ),
    timeoutRecoveryPolicy: definitiveTextField("timeoutRecoveryPolicy"),
  })
  .strict();

export type McpContractConfirmation = z.infer<
  typeof contractConfirmationSchema
>;

const runtimeEnvironmentSchema = z
  .object({
    PRAVA_MODE: runtimeModeSchema,
    PAYMENTS_ENABLED: booleanFlagSchema,
    ALLOW_PRAVA_SESSION_CREATION: booleanFlagSchema,
    ALLOW_PRAVA_LIVE_ORDER: booleanFlagSchema,
    PRAVA_MCP_CONTRACT_CONFIRMED: booleanFlagSchema.optional(),
    PRAVA_MCP_CONTRACT_CONFIRMATION: z.string().optional(),
  })
  .passthrough();

export type RuntimeMode = z.infer<typeof runtimeModeSchema>;

export type RuntimeConfig = {
  mode: RuntimeMode;
  paymentsEnabled: boolean;
  sessionCreationEnabled: boolean;
  liveOrderEnabled: boolean;
  mcpContractConfirmed: boolean;
  mcpContractConfirmation: McpContractConfirmation | null;
};

export type McpContractConfirmationParseFailure =
  | {
      kind: "invalid_json";
      message: string;
    }
  | {
      kind: "invalid_shape";
      message: string;
    };

export type McpContractConfirmationParseResult = {
  confirmation: McpContractConfirmation | null;
  failure: McpContractConfirmationParseFailure | null;
};

export function parseMcpContractConfirmationWithReason(
  raw: string,
): McpContractConfirmationParseResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return {
      confirmation: null,
      failure: {
        kind: "invalid_json",
        message:
          error instanceof Error
            ? error.message
            : "Malformed JSON in PRAVA_MCP_CONTRACT_CONFIRMATION",
      },
    };
  }

  const parsed = contractConfirmationSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const messages = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
    );
    return {
      confirmation: null,
      failure: {
        kind: "invalid_shape",
        message:
          messages.length === 0
            ? "PRAVA_MCP_CONTRACT_CONFIRMATION does not match required support schema"
            : messages.join("; "),
      },
    };
  }

  return { confirmation: parsed.data, failure: null };
}

export function parseMcpContractConfirmation(
  raw: string,
): McpContractConfirmation | null {
  return parseMcpContractConfirmationWithReason(raw).confirmation;
}

export type RuntimeConfigurationErrorCode =
  | "INVALID_MODE"
  | "INVALID_FLAGS"
  | "REPLAY_FLAGS_UNSAFE"
  | "SANDBOX_FLAGS_INCOMPLETE"
  | "LIVE_FLAGS_INCOMPLETE"
  | "LIVE_MCP_CONTRACT_UNCONFIRMED";

export class RuntimeConfigurationError extends Error {
  constructor(
    public readonly code: RuntimeConfigurationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RuntimeConfigurationError";
  }
}

export function parseRuntimeConfig(
  environment: Record<string, string | undefined>,
): RuntimeConfig {
  if (!runtimeModeSchema.safeParse(environment.PRAVA_MODE).success) {
    throw new RuntimeConfigurationError(
      "INVALID_MODE",
      "PRAVA_MODE must be replay, sandbox, or live",
    );
  }

  const parsed = runtimeEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new RuntimeConfigurationError(
      "INVALID_FLAGS",
      "All payment safety flags must be explicitly true or false",
      { cause: parsed.error },
    );
  }

  const config: RuntimeConfig = {
    mode: parsed.data.PRAVA_MODE,
    paymentsEnabled: parsed.data.PAYMENTS_ENABLED,
    sessionCreationEnabled: parsed.data.ALLOW_PRAVA_SESSION_CREATION,
    liveOrderEnabled: parsed.data.ALLOW_PRAVA_LIVE_ORDER,
    mcpContractConfirmed: parsed.data.PRAVA_MCP_CONTRACT_CONFIRMED ?? false,
    mcpContractConfirmation: null,
  };

  if (
    config.mode === "replay" &&
    (config.paymentsEnabled ||
      config.sessionCreationEnabled ||
      config.liveOrderEnabled)
  ) {
    throw new RuntimeConfigurationError(
      "REPLAY_FLAGS_UNSAFE",
      "Replay mode requires every payment flag to be false",
    );
  }

  if (
    config.mode === "sandbox" &&
    (!config.paymentsEnabled ||
      !config.sessionCreationEnabled ||
      config.liveOrderEnabled)
  ) {
    throw new RuntimeConfigurationError(
      "SANDBOX_FLAGS_INCOMPLETE",
      "Sandbox requires payments and sessions enabled, with live orders disabled",
    );
  }

  if (
    config.mode === "live" &&
    (!config.paymentsEnabled ||
      !config.sessionCreationEnabled ||
      !config.liveOrderEnabled)
  ) {
    throw new RuntimeConfigurationError(
      "LIVE_FLAGS_INCOMPLETE",
      "Live mode requires all payment flags to be explicitly enabled",
    );
  }

  if (config.mode === "live" && !config.mcpContractConfirmed) {
    throw new RuntimeConfigurationError(
      "LIVE_MCP_CONTRACT_UNCONFIRMED",
      "Live mode requires explicit Prava MCP contract confirmation from support@prava.space",
    );
  }

  if (config.mode === "live") {
    const rawConfirmation = parsed.data.PRAVA_MCP_CONTRACT_CONFIRMATION;
    if (rawConfirmation === undefined) {
      throw new RuntimeConfigurationError(
        "LIVE_MCP_CONTRACT_UNCONFIRMED",
        "Live mode requires a written support confirmation payload in PRAVA_MCP_CONTRACT_CONFIRMATION from support@prava.space",
      );
    }
    const parsedConfirmation =
      parseMcpContractConfirmationWithReason(rawConfirmation);
    const confirmation = parsedConfirmation.confirmation;
    if (!confirmation) {
      throw new RuntimeConfigurationError(
        "LIVE_MCP_CONTRACT_UNCONFIRMED",
        `PRAVA_MCP_CONTRACT_CONFIRMATION must be valid support@prava.space confirmation data before live execution: ${parsedConfirmation.failure?.message ?? "invalid format"}`,
      );
    }
    config.mcpContractConfirmation = confirmation;
  }

  if (config.mode === "live" && !config.mcpContractConfirmation) {
    throw new RuntimeConfigurationError(
      "LIVE_MCP_CONTRACT_UNCONFIRMED",
      "Live mode requires a written support@prava.space confirmation payload in PRAVA_MCP_CONTRACT_CONFIRMATION",
    );
  }

  return config;
}
