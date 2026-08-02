import {
  answerLiveRequestClarification,
  authorizeLiveRequestCapability,
  liveRouteError,
} from "@/live/service";
import {
  assertCapabilityRateLimit,
  assertTrustedMutationOrigin,
  privateResponseHeaders,
  readBearerCapability,
  readBoundedJson,
} from "@/server/request-security";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({ answer: z.string().trim().min(1).max(500) })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  try {
    assertTrustedMutationOrigin(request);
    const capability = readBearerCapability(request);
    const { requestId } = await context.params;
    await authorizeLiveRequestCapability(requestId, capability);
    assertCapabilityRateLimit(request, capability, { rateLimit: 6 });
    const body = bodySchema.parse(await readBoundedJson(request, 2_048));
    return Response.json(
      {
        request: await answerLiveRequestClarification(requestId, body.answer),
      },
      { headers: privateResponseHeaders },
    );
  } catch (error) {
    return liveRouteError(error);
  }
}
