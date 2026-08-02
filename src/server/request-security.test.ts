import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RequestSecurityError,
  assertCapabilityRateLimit,
  assertMatchingCapability,
  assertTrustedMutationOrigin,
  assertTrustedMutationRequest,
  readExecutionCapability,
  readBearerCapability,
  readBoundedJson,
  resetRequestSecurityStateForTests,
} from "./request-security";

function mutation(origin = "http://localhost:3000"): Request {
  return new Request("http://localhost:3000/api/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ ok: true }),
  });
}

describe("request security", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRequestSecurityStateForTests();
  });

  it("accepts same-origin JSON mutations and parses bounded bodies", async () => {
    const request = mutation();
    expect(() => assertTrustedMutationRequest(request)).not.toThrow();
    await expect(readBoundedJson(request, 1_024)).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects cross-origin requests", () => {
    expect(() =>
      assertTrustedMutationRequest(mutation("https://attacker.example")),
    ).toThrowError(
      expect.objectContaining<Partial<RequestSecurityError>>({
        code: "INVALID_ORIGIN",
        status: 403,
      }),
    );
  });

  it("trusts only the configured production origin and host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://relaybuy.example");
    const trusted = new Request("https://relaybuy.example/api/test", {
      headers: {
        host: "relaybuy.example",
        origin: "https://relaybuy.example",
        "sec-fetch-site": "same-origin",
      },
      method: "POST",
    });
    expect(() => assertTrustedMutationOrigin(trusted)).not.toThrow();

    for (const hostile of [
      new Request("https://attacker.example/api/test", {
        headers: {
          host: "attacker.example",
          origin: "https://attacker.example",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      new Request("https://relaybuy.example/api/test", {
        headers: {
          host: "relaybuy.example",
          origin: "https://relaybuy.example",
          "sec-fetch-site": "same-origin",
          "x-forwarded-host": "attacker.example",
        },
        method: "POST",
      }),
      new Request("https://relaybuy.example/api/test", {
        headers: {
          host: "relaybuy.example",
          origin: "https://attacker.example",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
    ]) {
      expect(() => assertTrustedMutationOrigin(hostile)).toThrowError(
        expect.objectContaining<Partial<RequestSecurityError>>({
          code: "INVALID_ORIGIN",
          status: 403,
        }),
      );
    }
  });

  it("accepts equivalent same-port loopback aliases in a local production run", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    const trusted = new Request("http://127.0.0.1:3000/api/test", {
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
      },
      method: "POST",
    });

    expect(() => assertTrustedMutationOrigin(trusted)).not.toThrow();

    for (const hostile of [
      new Request("http://127.0.0.1:3001/api/test", {
        headers: {
          host: "127.0.0.1:3001",
          origin: "http://127.0.0.1:3001",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      new Request("http://attacker.example:3000/api/test", {
        headers: {
          host: "attacker.example:3000",
          origin: "http://attacker.example:3000",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      new Request("http://127.0.0.1:3000/api/test", {
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "sec-fetch-site": "same-origin",
          "x-forwarded-host": "attacker.example",
        },
        method: "POST",
      }),
    ]) {
      expect(() => assertTrustedMutationOrigin(hostile)).toThrowError(
        expect.objectContaining<Partial<RequestSecurityError>>({
          code: "INVALID_ORIGIN",
          status: 403,
        }),
      );
    }
  });

  it("requires APP_BASE_URL for production mutations", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", "");
    expect(() => assertTrustedMutationOrigin(mutation())).toThrowError(
      expect.objectContaining<Partial<RequestSecurityError>>({
        code: "INVALID_ORIGIN",
        status: 500,
      }),
    );
  });

  it("uses Render's public service URL when APP_BASE_URL is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://relaybuy-example.onrender.com");
    const trusted = new Request(
      "https://relaybuy-example.onrender.com/api/test",
      {
        headers: {
          host: "relaybuy-example.onrender.com",
          origin: "https://relaybuy-example.onrender.com",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      },
    );

    expect(() => assertTrustedMutationOrigin(trusted)).not.toThrow();
  });

  it("checks mutation origin before authenticated work", () => {
    expect(() => assertTrustedMutationOrigin(mutation())).not.toThrow();
    expect(() =>
      assertTrustedMutationOrigin(mutation("https://attacker.example")),
    ).toThrowError(
      expect.objectContaining<Partial<RequestSecurityError>>({
        code: "INVALID_ORIGIN",
        status: 403,
      }),
    );
  });

  it("enforces request limits", async () => {
    await expect(readBoundedJson(mutation(), 2)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      status: 413,
    });
  });

  it("requires a bounded bearer capability", () => {
    const authorized = mutation();
    authorized.headers.set("authorization", `Bearer rb_req_${"a".repeat(43)}`);

    expect(readBearerCapability(authorized)).toBe(`rb_req_${"a".repeat(43)}`);
    expect(() => readBearerCapability(mutation())).toThrowError(
      expect.objectContaining<Partial<RequestSecurityError>>({
        code: "UNAUTHORIZED",
        status: 401,
      }),
    );
  });

  it("reads execution capabilities only from the HttpOnly cookie channel", () => {
    const capability = `rb_exec_${"a".repeat(43)}`;
    const request = mutation();
    request.headers.set(
      "cookie",
      `other=value; relaybuy_execution=${capability}`,
    );
    expect(readExecutionCapability(request)).toBe(capability);
    expect(() => readExecutionCapability(mutation())).toThrowError(
      expect.objectContaining<Partial<RequestSecurityError>>({
        code: "UNAUTHORIZED",
        status: 401,
      }),
    );
  });

  it("binds a supplied capability to the requested operation", () => {
    const capability = "a".repeat(43);
    expect(() =>
      assertMatchingCapability(capability, capability),
    ).not.toThrow();
    expect(() =>
      assertMatchingCapability(capability, "b".repeat(43)),
    ).toThrowError(
      expect.objectContaining<Partial<RequestSecurityError>>({
        code: "UNAUTHORIZED",
        status: 401,
      }),
    );
  });

  it.each([
    {
      first: "198.51.100.1, 203.0.113.8",
      header: "x-forwarded-for",
      second: "198.51.100.2, 203.0.113.9",
    },
    {
      first: "198.51.100.1",
      header: "x-real-ip",
      second: "203.0.113.9",
    },
    {
      first: "relaybuy-session=first",
      header: "cookie",
      second: "relaybuy-session=second",
    },
  ])(
    "uses one anonymous rate bucket when untrusted $header differs",
    (headerCase) => {
      const first = mutation();
      first.headers.set(headerCase.header, headerCase.first);
      const second = mutation();
      second.headers.set(headerCase.header, headerCase.second);

      expect(() =>
        assertTrustedMutationRequest(first, { rateLimit: 1 }),
      ).not.toThrow();
      expect(() =>
        assertTrustedMutationRequest(second, { rateLimit: 1 }),
      ).toThrowError(
        expect.objectContaining<Partial<RequestSecurityError>>({
          code: "RATE_LIMITED",
          status: 429,
        }),
      );
    },
  );

  it("uses only the nearest address when proxy headers are trusted", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    const first = mutation();
    first.headers.set("x-forwarded-for", "198.51.100.1, 203.0.113.8");
    const sameProxy = mutation();
    sameProxy.headers.set("x-forwarded-for", "198.51.100.2, 203.0.113.8");
    const differentProxy = mutation();
    differentProxy.headers.set("x-forwarded-for", "198.51.100.2, 203.0.113.9");

    expect(() =>
      assertTrustedMutationRequest(first, { rateLimit: 1 }),
    ).not.toThrow();
    expect(() =>
      assertTrustedMutationRequest(sameProxy, { rateLimit: 1 }),
    ).toThrowError(
      expect.objectContaining<Partial<RequestSecurityError>>({
        code: "RATE_LIMITED",
        status: 429,
      }),
    );
    expect(() =>
      assertTrustedMutationRequest(differentProxy, { rateLimit: 1 }),
    ).not.toThrow();
  });

  it("keeps explicitly supplied capability identities in separate buckets", () => {
    const firstCapability = `rb_req_${"a".repeat(43)}`;
    const secondCapability = `rb_req_${"b".repeat(43)}`;

    expect(() =>
      assertCapabilityRateLimit(mutation(), firstCapability, {
        rateLimit: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertCapabilityRateLimit(mutation(), secondCapability, {
        rateLimit: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertCapabilityRateLimit(mutation(), firstCapability, {
        rateLimit: 1,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RequestSecurityError>>({
        code: "RATE_LIMITED",
        status: 429,
      }),
    );
  });
});
