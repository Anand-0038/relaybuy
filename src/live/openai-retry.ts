import { ZodError } from "zod";

export type OpenAiExtractionErrorDisposition =
  | "fallback_model"
  | "retry_same_model"
  | "fail_closed";

export type OpenAiExtractionFailureCode =
  | "OPENAI_AUTH_FAILED"
  | "OPENAI_CAPACITY_UNAVAILABLE"
  | "OPENAI_EXTRACTION_FAILED"
  | "OPENAI_MODEL_UNAVAILABLE"
  | "OPENAI_UNAVAILABLE";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorFacts(error: unknown): {
  codes: string[];
  status: number | undefined;
} {
  if (!isRecord(error)) {
    return { codes: [], status: undefined };
  }
  const nestedError = isRecord(error.error) ? error.error : undefined;
  const status =
    typeof error.status === "number"
      ? error.status
      : typeof nestedError?.status === "number"
        ? nestedError.status
        : undefined;
  const codes = [
    error.code,
    error.name,
    nestedError?.code,
    nestedError?.type,
  ].filter((value): value is string => typeof value === "string");
  return { codes, status };
}

export function classifyOpenAiExtractionFailureCode(
  error: unknown,
): OpenAiExtractionFailureCode {
  if (error instanceof ZodError) {
    return "OPENAI_EXTRACTION_FAILED";
  }
  const { codes, status } = errorFacts(error);
  if (status === 401 || status === 403) {
    return "OPENAI_AUTH_FAILED";
  }
  if (
    status === 404 ||
    codes.some((code) =>
      [
        "invalid_model",
        "model_deprecated",
        "model_not_found",
        "unsupported_model",
      ].includes(code),
    )
  ) {
    return "OPENAI_MODEL_UNAVAILABLE";
  }
  if (
    status === 429 ||
    codes.some((code) =>
      ["insufficient_quota", "rate_limit_exceeded"].includes(code),
    )
  ) {
    return "OPENAI_CAPACITY_UNAVAILABLE";
  }
  if (
    (status !== undefined && status >= 500) ||
    codes.some((code) =>
      [
        "ETIMEDOUT",
        "ECONNRESET",
        "AbortError",
        "server_error",
        "timeout",
      ].includes(code),
    )
  ) {
    return "OPENAI_UNAVAILABLE";
  }
  return "OPENAI_EXTRACTION_FAILED";
}

export function classifyOpenAiExtractionError(
  error: unknown,
): OpenAiExtractionErrorDisposition {
  if (error instanceof ZodError) {
    return "retry_same_model";
  }
  if (!isRecord(error)) {
    return "fail_closed";
  }

  const { codes, status } = errorFacts(error);

  if (codes.includes("insufficient_quota")) {
    return "fail_closed";
  }

  if (
    status === 404 ||
    codes.some((code) =>
      [
        "invalid_model",
        "model_deprecated",
        "model_not_found",
        "unsupported_model",
      ].includes(code),
    )
  ) {
    return "fallback_model";
  }

  if (
    status === 429 ||
    (status !== undefined && status >= 500) ||
    codes.some((code) =>
      [
        "ETIMEDOUT",
        "ECONNRESET",
        "AbortError",
        "rate_limit_exceeded",
        "server_error",
        "timeout",
      ].includes(code),
    )
  ) {
    return "retry_same_model";
  }

  return "fail_closed";
}
