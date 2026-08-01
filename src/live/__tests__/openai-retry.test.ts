import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  classifyOpenAiExtractionError,
  classifyOpenAiExtractionFailureCode,
} from "../openai-retry";

describe("OpenAI extraction retry policy", () => {
  it.each([
    [{ status: 429, error: { code: "insufficient_quota" } }, "fail_closed"],
    [{ status: 429 }, "retry_same_model"],
    [{ status: 503 }, "retry_same_model"],
    [{ code: "ETIMEDOUT" }, "retry_same_model"],
    [{ name: "AbortError" }, "retry_same_model"],
    [
      new ZodError([
        {
          code: "custom",
          message: "schema mismatch",
          path: [],
        },
      ]),
      "retry_same_model",
    ],
    [{ status: 404, code: "model_not_found" }, "fallback_model"],
    [{ status: 401, code: "invalid_api_key" }, "fail_closed"],
  ] as const)("classifies %j as %s", (error, expected) => {
    expect(classifyOpenAiExtractionError(error)).toBe(expected);
  });
});

describe("OpenAI extraction operator failure codes", () => {
  it.each([
    [
      { status: 429, error: { code: "insufficient_quota" } },
      "OPENAI_CAPACITY_UNAVAILABLE",
    ],
    [{ status: 401, code: "invalid_api_key" }, "OPENAI_AUTH_FAILED"],
    [{ status: 404, code: "model_not_found" }, "OPENAI_MODEL_UNAVAILABLE"],
    [{ status: 503 }, "OPENAI_UNAVAILABLE"],
    [{ code: "unexpected" }, "OPENAI_EXTRACTION_FAILED"],
  ] as const)("maps %j to %s", (error, expected) => {
    expect(classifyOpenAiExtractionFailureCode(error)).toBe(expected);
  });
});
