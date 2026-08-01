const optionKeyAliases: Readonly<Record<string, string>> = {
  colour: "color",
};

export type OptionNormalizationErrorCode =
  | "EMPTY_OPTIONS"
  | "INVALID_OPTION_KEY"
  | "INVALID_OPTION_VALUE"
  | "CONFLICTING_OPTION";

export class OptionNormalizationError extends Error {
  constructor(
    public readonly code: OptionNormalizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OptionNormalizationError";
  }
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function normalizeKey(key: string): string {
  const normalized = normalizeText(key);

  if (!normalized) {
    throw new OptionNormalizationError(
      "INVALID_OPTION_KEY",
      "Option keys must not be empty",
    );
  }

  return optionKeyAliases[normalized] ?? normalized;
}

function normalizeValue(value: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new OptionNormalizationError(
      "INVALID_OPTION_VALUE",
      "Option values must not be empty",
    );
  }

  return normalized;
}

export function normalizeOptionTuple(
  options: Readonly<Record<string, string>>,
): Record<string, string> {
  if (Object.keys(options).length === 0) {
    throw new OptionNormalizationError(
      "EMPTY_OPTIONS",
      "At least one product option is required",
    );
  }

  const normalizedEntries = new Map<string, string>();

  for (const [rawKey, rawValue] of Object.entries(options)) {
    const key = normalizeKey(rawKey);
    const value = normalizeValue(rawValue);
    const existingValue = normalizedEntries.get(key);

    if (existingValue !== undefined && existingValue !== value) {
      throw new OptionNormalizationError(
        "CONFLICTING_OPTION",
        `Option ${key} has conflicting values`,
      );
    }

    normalizedEntries.set(key, value);
  }

  return Object.fromEntries(
    [...normalizedEntries.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}
