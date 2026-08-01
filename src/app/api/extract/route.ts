import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ExtractionAgentError,
  extractRequestWithAgent,
  extractionInputSchema,
} from "../../../agent/extraction";
import {
  RequestSecurityError,
  assertTrustedMutationRequest,
  privateResponseHeaders,
  readBoundedJson,
} from "../../../server/request-security";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationRequest(request, { rateLimit: 12 });

    if (
      process.env.OPENAI_EXTRACTION_ENABLED !== "true" ||
      !process.env.OPENAI_API_KEY
    ) {
      return NextResponse.json(
        {
          error: {
            code: "EXTRACTION_DISABLED",
            message: "Live OpenAI extraction is not enabled",
          },
        },
        { status: 503, headers: privateResponseHeaders },
      );
    }

    const body = await readBoundedJson(request, 32_768);
    const input = extractionInputSchema.parse(body);
    const result = await extractRequestWithAgent(input);

    return NextResponse.json(result, { headers: privateResponseHeaders });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status, headers: privateResponseHeaders },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_EXTRACTION_INPUT",
            message: "The extraction request is invalid",
          },
        },
        { status: 400, headers: privateResponseHeaders },
      );
    }

    if (error instanceof ExtractionAgentError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: "The extraction result could not be validated",
          },
        },
        { status: 502, headers: privateResponseHeaders },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "EXTRACTION_UNAVAILABLE",
          message: "Live extraction is temporarily unavailable",
        },
      },
      { status: 502, headers: privateResponseHeaders },
    );
  }
}
