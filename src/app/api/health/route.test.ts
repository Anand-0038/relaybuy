import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns process liveness without connected readiness details", async () => {
    const response = GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ service: "relaybuy", status: "ok" });
    expect(body.timestamp).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("integrations");
    expect(body).not.toHaveProperty("contractConfirmation");
    expect(body).not.toHaveProperty("liveReady");
  });
});
