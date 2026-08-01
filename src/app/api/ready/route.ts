import { probeConnectedReadiness } from "@/live/readiness";
import { liveRouteError } from "@/live/service";
import {
  assertCapabilityRateLimit,
  assertMatchingCapability,
  privateResponseHeaders,
  readBearerCapability,
} from "@/server/request-security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const configuredCapability = process.env.READINESS_PROBE_TOKEN;
    if (!configuredCapability || configuredCapability.length < 32) {
      return Response.json(
        {
          error: {
            code: "READINESS_NOT_CONFIGURED",
            message: "Connected readiness probing is not configured.",
          },
        },
        { headers: privateResponseHeaders, status: 503 },
      );
    }

    const suppliedCapability = readBearerCapability(request);
    assertMatchingCapability(configuredCapability, suppliedCapability);
    assertCapabilityRateLimit(request, suppliedCapability, { rateLimit: 2 });

    const readiness = await probeConnectedReadiness();
    return Response.json(readiness, {
      headers: privateResponseHeaders,
      status: readiness.status === "ready" ? 200 : 503,
    });
  } catch (error) {
    return liveRouteError(error);
  }
}
