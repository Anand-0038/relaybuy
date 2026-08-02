import {
  consumeLiveApproval,
  liveRouteError,
  previewLiveApproval,
  previewLiveExecution,
  rejectLiveApproval,
} from "@/live/service";
import {
  assertCapabilityRateLimit,
  assertMatchingCapability,
  assertTrustedMutationOrigin,
  EXECUTION_CAPABILITY_COOKIE,
  privateResponseHeaders,
  readBearerCapability,
  readExecutionCapability,
} from "@/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const { token } = await context.params;
    try {
      return Response.json(
        { request: await previewLiveApproval(token) },
        { headers: privateResponseHeaders },
      );
    } catch {
      const executionCapability = readExecutionCapability(request);
      return Response.json(
        { request: await previewLiveExecution(executionCapability) },
        { headers: privateResponseHeaders },
      );
    }
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
    const consumed = await consumeLiveApproval(token);
    const headers = new Headers(privateResponseHeaders);
    const maxAge = Math.max(
      0,
      Math.floor(
        (new Date(consumed.executionExpiresAt).getTime() - Date.now()) / 1_000,
      ),
    );
    headers.append(
      "Set-Cookie",
      `${EXECUTION_CAPABILITY_COOKIE}=${encodeURIComponent(consumed.executionCapability)}; Path=/api/live; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    return Response.json({ request: consumed.request }, { headers });
  } catch (error) {
    return liveRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const { token } = await context.params;
    assertTrustedMutationOrigin(request);
    const capability = readBearerCapability(request);
    assertMatchingCapability(token, capability);
    assertCapabilityRateLimit(request, capability, { rateLimit: 6 });
    return Response.json(
      { request: await rejectLiveApproval(token) },
      { headers: privateResponseHeaders },
    );
  } catch (error) {
    return liveRouteError(error);
  }
}
