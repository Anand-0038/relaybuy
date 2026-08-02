import { createHash } from "node:crypto";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function stitchChunks(results) {
  return [...results]
    .sort((left, right) => left.chunk_index - right.chunk_index)
    .reduce((stitched, result) => {
      const chunkText = String(result.chunk_text ?? "");
      if (!stitched) return chunkText;
      if (stitched.includes(chunkText)) return stitched;
      const maximumOverlap = Math.min(stitched.length, chunkText.length);
      for (let overlap = maximumOverlap; overlap > 0; overlap -= 1) {
        if (stitched.endsWith(chunkText.slice(0, overlap))) {
          return stitched + chunkText.slice(overlap);
        }
      }
      return `${stitched}\n${chunkText}`;
    }, "");
}

export function extractPolicyBindings(results) {
  const groups = new Map();
  for (const result of results) {
    if (
      typeof result.content_id !== "string" ||
      typeof result.version_id !== "string"
    ) {
      continue;
    }
    const key = `${result.content_id}\u0000${result.version_id}`;
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }

  return [...groups.values()].flatMap((group) => {
    const lines = stitchChunks(group).split(/\r?\n/);
    const compactRecordLine = lines.find((line) =>
      line.trim().startsWith("RELAYBUY_POLICY_RECORD_V2:"),
    );
    const recordLine = lines.find((line) =>
      line.trim().startsWith("RELAYBUY_POLICY_RECORD:"),
    );
    if (compactRecordLine) {
      try {
        const [
          schemaVersion,
          merchantStatus,
          merchantDomain,
          productHandle,
          allowedSkus,
          observedAtMs,
          freshUntilMs,
        ] = compactRecordLine
          .slice(compactRecordLine.indexOf(":") + 1)
          .trim()
          .split("|");
        const record = {
          allowedSkus: allowedSkus.split(",").filter(Boolean),
          freshUntil: new Date(Number(freshUntilMs)).toISOString(),
          merchantDomain,
          merchantStatus,
          observedAt: new Date(Number(observedAtMs)).toISOString(),
          productHandle,
          schemaVersion: Number(schemaVersion),
        };
        const recordDigest = createHash("sha256")
          .update(JSON.stringify(canonicalize(record)))
          .digest("hex");
        return [
          {
            binding: {
              contentId: group[0].content_id,
              recordDigest,
              versionId: group[0].version_id,
            },
            freshUntil: record.freshUntil,
          },
        ];
      } catch {
        return [];
      }
    }
    if (!recordLine) return [];
    try {
      const record = JSON.parse(
        recordLine.slice(recordLine.indexOf(":") + 1).trim(),
      );
      const recordDigest = createHash("sha256")
        .update(JSON.stringify(canonicalize(record)))
        .digest("hex");
      return [
        {
          binding: {
            contentId: group[0].content_id,
            recordDigest,
            versionId: group[0].version_id,
          },
          freshUntil: record.freshUntil,
        },
      ];
    } catch {
      return [];
    }
  });
}
