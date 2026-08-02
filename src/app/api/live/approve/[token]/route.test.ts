import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeLiveApproval = vi.hoisted(() => vi.fn());

vi.mock("@/live/service", () => ({
  consumeLiveApproval,
  liveRouteError: (error: unknown) => {
    throw error;
  },
  previewLiveApproval: vi.fn(),
  previewLiveExecution: vi.fn(),
  rejectLiveApproval: vi.fn(),
}));

import { POST } from "./route";

const token = "a".repeat(43);
const requestId = "00000000-0000-4000-8000-000000000001";

describe("approval capability exchange route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeLiveApproval.mockResolvedValue({
      executionCapability: `rb_exec_${"b".repeat(43)}`,
      executionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      request: { id: requestId, state: "approved" },
    });
  });

  it("exchanges the URL token for a non-readable execution cookie", async () => {
    const response = await POST(
      new Request(`http://localhost:3000/api/live/approve/${token}`, {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      { params: Promise.resolve({ token }) },
    );
    const body = await response.text();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain("relaybuy_execution=rb_exec_");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/live");
    expect(body).not.toContain("rb_exec_");
  });
});
