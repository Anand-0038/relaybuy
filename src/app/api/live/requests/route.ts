import { createLiveRequest, liveRouteError } from "@/live/service";
import { createLiveRequestInputSchema } from "@/live/types";
import {
  assertTrustedMutationRequest,
  privateResponseHeaders,
  readBoundedJson,
} from "@/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedMutationRequest(request, { rateLimit: 12 });
    const created = await createLiveRequest(
      createLiveRequestInputSchema.parse(await readBoundedJson(request, 8_192)),
    );
    return Response.json(created, {
      headers: privateResponseHeaders,
      status: 201,
    });
  } catch (error) {
    return liveRouteError(error);
  }
}
