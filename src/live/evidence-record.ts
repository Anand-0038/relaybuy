import { createHash } from "node:crypto";

import { z } from "zod";

import {
  evidenceAuthorizationSchema,
  type EvidenceBundle,
  type SensoCitation,
} from "./types";

const embeddedRecordSchema = z
  .object({
    allowedSkus: z.array(z.string().min(1)).min(1),
    freshUntil: z.iso.datetime(),
    merchantDomain: z.string().min(1),
    merchantStatus: z.literal("approved"),
    observedAt: z.iso.datetime(),
    productHandle: z.string().min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

const POLICY_RECORD_PREFIX = "RELAYBUY_POLICY_RECORD:";

export interface SensoPolicyBinding {
  contentId: string;
  recordDigest: string;
  versionId: string;
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

export function hashStructuredPolicyRecord(record: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(record)))
    .digest("hex");
}

function parseEmbeddedRecord(
  chunkText: string,
): z.infer<typeof embeddedRecordSchema> | null {
  const recordLine = chunkText
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith(POLICY_RECORD_PREFIX));
  if (!recordLine) {
    return null;
  }
  const payload = recordLine.trim().slice(POLICY_RECORD_PREFIX.length).trim();
  return embeddedRecordSchema.parse(JSON.parse(payload));
}

function stitchCitationChunks(citations: readonly SensoCitation[]): string {
  return [...citations]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .reduce((stitched, citation) => {
      if (!stitched) return citation.chunkText;
      if (stitched.includes(citation.chunkText)) return stitched;
      const maximumOverlap = Math.min(
        stitched.length,
        citation.chunkText.length,
      );
      for (let overlap = maximumOverlap; overlap > 0; overlap -= 1) {
        if (stitched.endsWith(citation.chunkText.slice(0, overlap))) {
          return stitched + citation.chunkText.slice(overlap);
        }
      }
      return `${stitched}\n${citation.chunkText}`;
    }, "");
}

export function resolveStructuredAuthorization(
  citations: readonly SensoCitation[],
  policyBindings: readonly SensoPolicyBinding[],
): EvidenceBundle["authorization"] {
  if (policyBindings.length === 0) {
    throw new Error("No immutable Senso policy bindings are configured");
  }

  for (const binding of policyBindings) {
    const boundCitations = citations.filter(
      (citation) =>
        citation.contentId === binding.contentId &&
        citation.versionId === binding.versionId,
    );
    if (boundCitations.length === 0) continue;

    const record = parseEmbeddedRecord(stitchCitationChunks(boundCitations));
    if (!record) continue;
    const recordDigest = hashStructuredPolicyRecord(record);
    if (recordDigest !== binding.recordDigest) continue;
    const citationIds = boundCitations.map((citation) => citation.id);
    return evidenceAuthorizationSchema.parse({
      ...record,
      citationIds,
      contentId: binding.contentId,
      recordDigest,
      versionId: binding.versionId,
    });
  }

  throw new Error(
    "Senso did not return an allowlisted structured policy record",
  );
}

export function resolveSharedStructuredAuthorization(
  citationGroups: readonly [readonly SensoCitation[], readonly SensoCitation[]],
  policyBindings: readonly SensoPolicyBinding[],
): EvidenceBundle["authorization"] {
  const first = resolveStructuredAuthorization(
    citationGroups[0],
    policyBindings,
  );
  const second = resolveStructuredAuthorization(
    citationGroups[1],
    policyBindings,
  );
  if (
    first.contentId !== second.contentId ||
    first.versionId !== second.versionId ||
    first.recordDigest !== second.recordDigest
  ) {
    throw new Error(
      "Senso searches did not return the same immutable policy record",
    );
  }
  return evidenceAuthorizationSchema.parse({
    ...first,
    citationIds: [...new Set([...first.citationIds, ...second.citationIds])],
  });
}
