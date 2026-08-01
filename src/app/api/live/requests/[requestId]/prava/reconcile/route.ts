import {
  authorizeLiveApprovalCapability,
  liveRouteError,
  reconcileLivePravaSession,
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
    await authorizeLiveApprovalCapability(requestId, capability);
    assertCapabilityRateLimit(request, capability, { rateLimit: 20 });
    return Response.json(
      { request: await reconcileLivePravaSession(requestId) },
      { headers: privateResponseHeaders },
    );
  } catch (error) {
    return liveRouteError(error);
  }
}
