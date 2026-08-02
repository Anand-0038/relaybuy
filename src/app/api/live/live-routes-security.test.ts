import { describe, expect, it } from "vitest";

import { LiveOpenAiExtractionError } from "@/live/openai-extractor";
import { liveRouteError } from "@/live/service";

import { POST as consumeApproval } from "./approve/[token]/route";
import { POST as issueApproval } from "./requests/[requestId]/approval/route";
import { POST as answerClarification } from "./requests/[requestId]/clarification/route";
import { POST as evaluateRequest } from "./requests/[requestId]/evaluate/route";
import { POST as resolveEvidence } from "./requests/[requestId]/evidence/route";
import { POST as extractRequest } from "./requests/[requestId]/extract/route";
import { POST as executeMerchantCheckout } from "./requests/[requestId]/merchant/execute/route";
import { POST as reconcilePravaSession } from "./requests/[requestId]/prava/reconcile/route";
import { POST as createPravaSession } from "./requests/[requestId]/prava/session/route";
import { POST as revokePravaSession } from "./requests/[requestId]/prava/revoke/route";
import { GET as getRequest } from "./requests/[requestId]/route";
import { POST as createRequest } from "./requests/route";

const requestId = "00000000-0000-4000-8000-000000000001";

type RequestRouteHandler = (
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) => Promise<Response>;

type ProtectedRoute = {
  handler: RequestRouteHandler;
  method: "GET" | "POST";
  name: string;
  path: string;
};

const ownerProtectedRoutes: ProtectedRoute[] = [
  {
    handler: answerClarification,
    method: "POST",
    name: "request clarification",
    path: `/api/live/requests/${requestId}/clarification`,
  },
  {
    handler: getRequest,
    method: "GET",
    name: "request snapshot",
    path: `/api/live/requests/${requestId}`,
  },
  {
    handler: extractRequest,
    method: "POST",
    name: "intent extraction",
    path: `/api/live/requests/${requestId}/extract`,
  },
  {
    handler: resolveEvidence,
    method: "POST",
    name: "evidence resolution",
    path: `/api/live/requests/${requestId}/evidence`,
  },
  {
    handler: evaluateRequest,
    method: "POST",
    name: "policy evaluation",
    path: `/api/live/requests/${requestId}/evaluate`,
  },
  {
    handler: issueApproval,
    method: "POST",
    name: "approval issuance",
    path: `/api/live/requests/${requestId}/approval`,
  },
];

const approvalProtectedRoutes: ProtectedRoute[] = [
  {
    handler: createPravaSession,
    method: "POST",
    name: "Prava session creation",
    path: `/api/live/requests/${requestId}/prava/session`,
  },
  {
    handler: reconcilePravaSession,
    method: "POST",
    name: "Prava reconciliation",
    path: `/api/live/requests/${requestId}/prava/reconcile`,
  },
  {
    handler: executeMerchantCheckout,
    method: "POST",
    name: "merchant checkout",
    path: `/api/live/requests/${requestId}/merchant/execute`,
  },
  {
    handler: revokePravaSession,
    method: "POST",
    name: "Prava revocation",
    path: `/api/live/requests/${requestId}/prava/revoke`,
  },
];

function crossOriginMutation(path: string, body?: unknown): Request {
  const init: RequestInit = {
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    method: "POST",
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost:3000${path}`, init);
}

function protectedRequest(route: ProtectedRoute): Request {
  const init: RequestInit = { method: route.method };
  if (route.method === "POST") {
    init.headers = {
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
    };
  }
  return new Request(`http://localhost:3000${route.path}`, init);
}

describe("connected live route security", () => {
  it("rejects cross-origin request creation before parsing or persistence", async () => {
    const response = await createRequest(
      crossOriginMutation("/api/live/requests", {
        requestText: "Buy the approved ten dollar gift card",
        source: "web",
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_ORIGIN" },
    });
  });

  it("rejects cross-origin approval consumption at the capability boundary", async () => {
    const response = await consumeApproval(
      crossOriginMutation(`/api/live/approve/${"a".repeat(32)}`),
      { params: Promise.resolve({ token: "a".repeat(32) }) },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_ORIGIN" },
    });
  });

  it("rejects an approval bearer that does not match the URL capability", async () => {
    const token = "a".repeat(32);
    const response = await consumeApproval(
      new Request(`http://localhost:3000/api/live/approve/${token}`, {
        headers: {
          authorization: `Bearer ${"b".repeat(32)}`,
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      { params: Promise.resolve({ token }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("returns an honest capacity error without provider payload details", async () => {
    const response = liveRouteError(
      new LiveOpenAiExtractionError("OPENAI_CAPACITY_UNAVAILABLE", {
        cause: new Error("private provider payload"),
      }),
    );
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("OPENAI_CAPACITY_UNAVAILABLE");
    expect(body.error.message).toContain("no fallback extraction");
    expect(JSON.stringify(body)).not.toContain("private provider payload");
  });

  it.each(ownerProtectedRoutes)(
    "rejects missing owner capability before $name work",
    async (route) => {
      const response = await route.handler(protectedRequest(route), {
        params: Promise.resolve({ requestId }),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "UNAUTHORIZED" },
      });
    },
  );

  it.each(approvalProtectedRoutes)(
    "rejects missing approval capability before $name work",
    async (route) => {
      const response = await route.handler(protectedRequest(route), {
        params: Promise.resolve({ requestId }),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "UNAUTHORIZED" },
      });
    },
  );
});
