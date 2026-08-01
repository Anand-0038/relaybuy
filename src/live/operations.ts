import { createHash } from "node:crypto";

function digest(namespace: string, parts: string[]): string {
  const hash = createHash("sha256");
  hash.update(namespace);
  for (const part of parts) {
    hash.update("\0");
    hash.update(part);
  }
  return hash.digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function createMerchantAttemptDigest(attempt: unknown): string {
  return digest("relaybuy:merchant-attempt:v1", [
    JSON.stringify(canonicalize(attempt)),
  ]);
}

export function createSessionIdempotencyKey(artifactHash: string): string {
  return digest("relaybuy:prava-session:v1", [artifactHash]);
}

export function createOutcomeReportIdempotencyKey(
  txnRefId: string,
  merchantAttemptDigest: string,
): string {
  return digest("relaybuy:prava-outcome-report:v1", [
    txnRefId,
    merchantAttemptDigest,
  ]);
}
