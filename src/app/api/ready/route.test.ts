import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ probeConnectedReadiness: vi.fn() }));

vi.mock("@/live/readiness", () => ({
  probeConnectedReadiness: mocks.probeConnectedReadiness,
}));

import { resetRequestSecurityStateForTests } from "@/server/request-security";

import { GET } from "./route";

const blocked = {
  checkedAt: "2026-08-01T12:00:00.000Z",
  checks: {
    database: { status: "ready" },
    merchant: { status: "ready" },
    openai: { code: "OPENAI_CAPACITY_UNAVAILABLE", status: "blocked" },
    paymentSafety: { status: "ready" },
    policy: { code: "DEPENDENCY_BLOCKED", status: "blocked" },
    pravaAuthentication: { status: "ready" },
    senso: { code: "DEPENDENCY_BLOCKED", status: "blocked" },
  },
  status: "blocked",
} as const;

describe("GET /api/ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("READINESS_PROBE_TOKEN", "r".repeat(43));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRequestSecurityStateForTests();
  });

  function readinessRequest(token = "r".repeat(43)): Request {
    return new Request("http://localhost:3000/api/ready", {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it("rejects an unauthenticated probe before provider work", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ready"));

    expect(response.status).toBe(401);
    expect(mocks.probeConnectedReadiness).not.toHaveBeenCalled();
  });

  it("returns 503 with safe dependency status when the core path is blocked", async () => {
    mocks.probeConnectedReadiness.mockResolvedValue(blocked);

    const response = await GET(readinessRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toEqual(blocked);
    expect(JSON.stringify(body)).not.toContain("sk_test_");
  });

  it("returns 200 only after the active connected probe passes", async () => {
    mocks.probeConnectedReadiness.mockResolvedValue({
      ...blocked,
      checks: Object.fromEntries(
        Object.keys(blocked.checks).map((name) => [name, { status: "ready" }]),
      ),
      status: "ready",
    });

    const response = await GET(readinessRequest());

    expect(response.status).toBe(200);
  });
});
