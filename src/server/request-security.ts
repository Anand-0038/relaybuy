import { createHash, timingSafeEqual } from "node:crypto";

const ANONYMOUS_RATE_LIMIT_IDENTITY = "anonymous";
const DEFAULT_RATE_LIMIT = 30;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 10_000;

type RateBucket = {
  count: number;
  resetAt: number;
};

type RateLimitState = typeof globalThis & {
  __relayBuyRateLimits?: Map<string, RateBucket>;
};

const rateLimitState = globalThis as RateLimitState;
const rateLimits =
  rateLimitState.__relayBuyRateLimits ??
  (rateLimitState.__relayBuyRateLimits = new Map<string, RateBucket>());

export const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

export type RequestSecurityErrorCode =
  | "INVALID_CONTENT_TYPE"
  | "INVALID_ORIGIN"
  | "REQUEST_TOO_LARGE"
  | "RATE_LIMITED"
  | "UNAUTHORIZED";

export class RequestSecurityError extends Error {
  constructor(
    public readonly code: RequestSecurityErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RequestSecurityError";
  }
}

function allowedOrigins(request: Request): Set<string> {
  const configured = process.env.APP_BASE_URL?.trim();
  const origins = new Set([new URL(request.url).origin]);

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  if (configured) {
    try {
      origins.add(new URL(configured).origin);
    } catch {
      throw new RequestSecurityError(
        "INVALID_ORIGIN",
        500,
        "APP_BASE_URL is not a valid absolute URL",
      );
    }
  }

  return origins;
}

function enforceRateLimit(
  request: Request,
  limit: number,
  windowMs: number,
  suppliedIdentity?: string,
): void {
  const now = Date.now();

  if (rateLimits.size >= MAX_RATE_BUCKETS) {
    for (const [key, bucket] of rateLimits) {
      if (bucket.resetAt <= now) {
        rateLimits.delete(key);
      }
    }
  }

  while (rateLimits.size >= MAX_RATE_BUCKETS) {
    const oldestKey = rateLimits.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    rateLimits.delete(oldestKey);
  }

  const identity = suppliedIdentity
    ? createHash("sha256").update(suppliedIdentity).digest("hex")
    : ANONYMOUS_RATE_LIMIT_IDENTITY;
  const key = `${identity}:${new URL(request.url).pathname}`;
  const current = rateLimits.get(key);

  if (current === undefined || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (current.count >= limit) {
    throw new RequestSecurityError(
      "RATE_LIMITED",
      429,
      "Too many requests; retry after the current rate window",
    );
  }

  current.count += 1;
}

function trustedProxyIdentity(request: Request): string | undefined {
  if (process.env.TRUST_PROXY_HEADERS !== "true") return undefined;

  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  return forwarded ?? (request.headers.get("x-real-ip")?.trim() || undefined);
}

export function assertTrustedMutationRequest(
  request: Request,
  options: {
    rateLimit?: number;
    rateWindowMs?: number;
  } = {},
): void {
  assertTrustedMutationOrigin(request);
  enforceRateLimit(
    request,
    options.rateLimit ?? DEFAULT_RATE_LIMIT,
    options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS,
    trustedProxyIdentity(request),
  );
}

export function assertTrustedMutationOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const permittedOrigins = allowedOrigins(request);
  const fetchSite = request.headers.get("sec-fetch-site");

  if (
    origin === null ||
    !permittedOrigins.has(origin) ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    throw new RequestSecurityError(
      "INVALID_ORIGIN",
      403,
      "The request origin is not allowed",
    );
  }
}

export function assertCapabilityRateLimit(
  request: Request,
  capability: string,
  options: {
    rateLimit?: number;
    rateWindowMs?: number;
  } = {},
): void {
  enforceRateLimit(
    request,
    options.rateLimit ?? DEFAULT_RATE_LIMIT,
    options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS,
    capability,
  );
}

export function readBearerCapability(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/);
  if (!match) {
    throw new RequestSecurityError(
      "UNAUTHORIZED",
      401,
      "A valid request capability is required",
    );
  }
  return match[1]!;
}

export function assertMatchingCapability(
  expected: string,
  supplied: string,
): void {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  ) {
    throw new RequestSecurityError(
      "UNAUTHORIZED",
      401,
      "The capability does not match this operation",
    );
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (!contentType?.startsWith("application/json")) {
    throw new RequestSecurityError(
      "INVALID_CONTENT_TYPE",
      415,
      "The request must use application/json",
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestSecurityError(
      "REQUEST_TOO_LARGE",
      413,
      "The request body is too large",
    );
  }

  const serialized = await request.text();
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new RequestSecurityError(
      "REQUEST_TOO_LARGE",
      413,
      "The request body is too large",
    );
  }

  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }
}

export function resetRequestSecurityStateForTests(): void {
  rateLimits.clear();
}
