import {
  consumeLiveApproval,
  liveRouteError,
  previewLiveApproval,
} from "@/live/service";
import {
  assertCapabilityRateLimit,
  assertMatchingCapability,
  assertTrustedMutationOrigin,
  privateResponseHeaders,
  readBearerCapability,
} from "@/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const { token } = await context.params;
    return Response.json(
      { request: await previewLiveApproval(token) },
      { headers: privateResponseHeaders },
    );
  } catch (error) {
    return liveRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const { token } = await context.params;
    assertTrustedMutationOrigin(request);
    const capability = readBearerCapability(request);
    assertMatchingCapability(token, capability);
    assertCapabilityRateLimit(request, capability, { rateLimit: 12 });
    return Response.json(
      { request: await consumeLiveApproval(token) },
      { headers: privateResponseHeaders },
    );
  } catch (error) {
    return liveRouteError(error);
  }
}
