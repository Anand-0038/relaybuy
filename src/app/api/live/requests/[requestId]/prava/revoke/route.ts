import {
  authorizeLiveExecutionCapability,
  liveRouteError,
  revokeLivePravaSession,
} from "@/live/service";
import {
  assertCapabilityRateLimit,
  assertTrustedMutationOrigin,
  privateResponseHeaders,
  readExecutionCapability,
} from "@/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  try {
    assertTrustedMutationOrigin(request);
    const capability = readExecutionCapability(request);
    const { requestId } = await context.params;
    await authorizeLiveExecutionCapability(requestId, capability);
    assertCapabilityRateLimit(request, capability, { rateLimit: 4 });
    return Response.json(
      { request: await revokeLivePravaSession(requestId) },
      { headers: privateResponseHeaders },
    );
  } catch (error) {
    return liveRouteError(error);
  }
}
