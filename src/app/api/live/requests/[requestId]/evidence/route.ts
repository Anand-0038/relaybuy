import {
  authorizeLiveRequestCapability,
  liveRouteError,
  resolveLiveRequestEvidence,
} from "@/live/service";
import {
  assertCapabilityRateLimit,
  assertTrustedMutationOrigin,
  privateResponseHeaders,
  readBearerCapability,
} from "@/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  try {
    assertTrustedMutationOrigin(request);
    const capability = readBearerCapability(request);
    const { requestId } = await context.params;
    await authorizeLiveRequestCapability(requestId, capability);
    assertCapabilityRateLimit(request, capability);
    return Response.json(
      { request: await resolveLiveRequestEvidence(requestId) },
      { headers: privateResponseHeaders },
    );
  } catch (error) {
    return liveRouteError(error);
  }
}
