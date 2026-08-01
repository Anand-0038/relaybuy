import {
  authorizeLiveRequestCapability,
  getLiveRequest,
  liveRouteError,
} from "@/live/service";
import {
  assertCapabilityRateLimit,
  privateResponseHeaders,
  readBearerCapability,
} from "@/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  try {
    const capability = readBearerCapability(request);
    const { requestId } = await context.params;
    await authorizeLiveRequestCapability(requestId, capability);
    assertCapabilityRateLimit(request, capability);
    return Response.json(
      { request: await getLiveRequest(requestId) },
      { headers: privateResponseHeaders },
    );
  } catch (error) {
    return liveRouteError(error);
  }
}
