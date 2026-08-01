import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("development service-worker cleanup route", () => {
  it("serves a no-store self-unregistering worker in development", async () => {
    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("service-worker-allowed")).toBe("/");
    expect(body).toContain("self.registration.unregister()");
    expect(body).toContain("caches.delete");
  });
});
