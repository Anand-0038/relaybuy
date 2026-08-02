import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadProjectEnvironment } from "./project-env.mjs";
import { extractPolicyBindings } from "./senso-record.mjs";
import {
  buildMerchantEvidenceQuery,
  buildVariantEvidenceQuery,
} from "../src/live/senso-queries.ts";

loadProjectEnvironment({ protectedNames: ["SENSO_API_KEY"] });

const apiKey = process.env.SENSO_API_KEY;
const baseUrl = process.env.SENSO_BASE_URL ?? "https://apiv2.senso.ai/api/v1";
if (!apiKey) {
  throw new Error("SENSO_API_KEY is required");
}

const sourceUrl = "https://www.bonescoffee.com/products/gift-card.js";
const productResponse = await fetch(sourceUrl, {
  signal: AbortSignal.timeout(20_000),
});
if (!productResponse.ok) {
  throw new Error(`Merchant source returned ${productResponse.status}`);
}
const product = await productResponse.json();
const evidenceTtlMinutes = Number.parseInt(
  process.env.SENSO_EVIDENCE_TTL_MINUTES ?? "30",
  10,
);
if (
  !Number.isInteger(evidenceTtlMinutes) ||
  evidenceTtlMinutes < 15 ||
  evidenceTtlMinutes > 10_080
) {
  throw new Error(
    "SENSO_EVIDENCE_TTL_MINUTES must be an integer from 15 through 10080",
  );
}
const variants = product.variants.map((variant) => ({
  available: variant.available,
  id: variant.id,
  priceMinor: variant.price,
  requiresShipping: variant.requires_shipping,
  sku: variant.sku,
  taxable: variant.taxable,
  title: variant.title,
}));
const retrievedAt = new Date().toISOString();
const freshUntil = new Date(
  Date.now() + evidenceTtlMinutes * 60_000,
).toISOString();
const policyRecord = {
  allowedSkus: ["25933838657"],
  freshUntil,
  merchantDomain: "www.bonescoffee.com",
  merchantStatus: "approved",
  observedAt: retrievedAt,
  productHandle: "gift-card",
  schemaVersion: 1,
};
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
const recordDigest = createHash("sha256")
  .update(JSON.stringify(canonicalize(policyRecord)))
  .digest("hex");
const compactPolicyRecord = [
  policyRecord.schemaVersion,
  policyRecord.merchantStatus,
  policyRecord.merchantDomain,
  policyRecord.productHandle,
  policyRecord.allowedSkus.join(","),
  Date.parse(policyRecord.observedAt),
  Date.parse(policyRecord.freshUntil),
].join("|");
const markdown = `# RelayBuy canonical merchant and product evidence

Retrieved at: ${retrievedAt}
Fresh until: ${freshUntil}
Source: ${sourceUrl}
Merchant: Bones Coffee Company
Merchant domain: www.bonescoffee.com
Policy: ALLOWED_MERCHANT
Evidence digest: ${recordDigest}
RELAYBUY_POLICY_RECORD_V2:${compactPolicyRecord}

Canonical product: ${product.title}
Canonical handle: ${product.handle}
Canonical SKU: 25933838657
Canonical option: $10.00 e-gift card
Canonical price: 1000 USD minor units
Canonical quantity: 1
Canonical available: ${product.available}

## RelayBuy canonical rule

The approved checkout adapter is restricted to SKU 25933838657, the $10.00
e-gift-card denomination, quantity 1, zero fees, and a total of $10.00 USD.
SKU 25933838721 is the $25.00 near-match and must be refused for a $10.00
request. Any live source change blocks checkout.
`;

const bytes = Buffer.from(markdown);
const filename = "relaybuy-bones-coffee-gift-card-evidence.md";
const uploadRequest = await fetch(`${baseUrl}/org/kb/upload`, {
  body: JSON.stringify({
    files: [
      {
        content_hash_md5: createHash("md5").update(bytes).digest("hex"),
        content_type: "text/markdown",
        file_size_bytes: bytes.length,
        filename,
      },
    ],
  }),
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
  },
  method: "POST",
  signal: AbortSignal.timeout(30_000),
});
if (!uploadRequest.ok) {
  throw new Error(`Senso upload request returned ${uploadRequest.status}`);
}
const upload = (await uploadRequest.json()).results?.[0];
if (!upload?.upload_url || !upload?.content_id) {
  throw new Error("Senso did not return an upload target");
}

await new Promise((resolve, reject) => {
  const child = spawn(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--request",
      "PUT",
      "--header",
      "Content-Type: text/markdown",
      "--data-binary",
      "@-",
      upload.upload_url,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let errorText = "";
  child.stderr.on("data", (chunk) => {
    errorText += chunk.toString();
  });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`Senso object upload failed: ${errorText.trim()}`));
  });
  child.stdin.end(bytes);
});

let nodeId;
for (let attempt = 0; attempt < 30 && !nodeId; attempt += 1) {
  const treeResponse = await fetch(`${baseUrl}/org/kb/my-files?limit=500`, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(20_000),
  });
  const tree = await treeResponse.json();
  nodeId = tree.nodes?.find(
    (node) => node.content_id === upload.content_id,
  )?.kb_node_id;
  if (!nodeId) await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (!nodeId) {
  throw new Error("Senso KB node did not appear");
}

let status = "processing";
for (let attempt = 0; attempt < 90 && status !== "complete"; attempt += 1) {
  const nodeResponse = await fetch(
    `${baseUrl}/org/kb/nodes/${encodeURIComponent(nodeId)}/content`,
    {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(20_000),
    },
  );
  const node = await nodeResponse.json();
  status = node.processing_status;
  if (status === "failed") {
    throw new Error("Senso failed to index the canonical evidence");
  }
  if (status !== "complete") {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
if (status !== "complete") {
  throw new Error("Senso evidence indexing timed out");
}

const exactQueries = [
  buildMerchantEvidenceQuery({
    merchantDomain: "www.bonescoffee.com",
    merchantName: "Bones Coffee Company",
    productName: product.title,
  }),
  buildVariantEvidenceQuery({
    merchantDomain: "www.bonescoffee.com",
    merchantName: "Bones Coffee Company",
    productName: product.title,
    quotedColor: "$10.00 e-gift card",
    quotedSize: "Digital gift card",
    requestedProduct: "$10 Bones Coffee e-gift card",
    sku: "25933838657",
  }),
].map((query) =>
  [
    query,
    `Return the policy record with evidence digest "${recordDigest}".`,
    `Return the source retrieved exactly at "${retrievedAt}"`,
    `with freshness ending exactly at "${freshUntil}".`,
  ].join(" "),
);

const indexedBindings = [];
for (const query of exactQueries) {
  let indexedBinding;
  for (let attempt = 0; attempt < 30 && !indexedBinding; attempt += 1) {
    const searchResponse = await fetch(`${baseUrl}/org/search`, {
      body: JSON.stringify({ max_results: 50, query }),
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      method: "POST",
      signal: AbortSignal.timeout(20_000),
    });
    if (!searchResponse.ok) {
      throw new Error(
        `Senso runtime verification returned ${searchResponse.status}`,
      );
    }
    const search = await searchResponse.json();
    const verified = extractPolicyBindings(search.results ?? []).find(
      (candidate) =>
        candidate.binding.contentId === upload.content_id &&
        candidate.binding.recordDigest === recordDigest,
    );
    if (verified) {
      indexedBinding = verified.binding;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!indexedBinding) {
    throw new Error(
      "Senso indexed the file but an exact runtime query did not return the immutable policy record",
    );
  }
  indexedBindings.push(indexedBinding);
}

const [indexedBinding] = indexedBindings;
if (
  indexedBindings.some(
    (binding) =>
      binding.contentId !== indexedBinding.contentId ||
      binding.versionId !== indexedBinding.versionId ||
      binding.recordDigest !== indexedBinding.recordDigest,
  )
) {
  throw new Error("Exact Senso queries returned different immutable records");
}

const updateEnvironment = process.argv.includes("--update-env");
if (updateEnvironment) {
  const environmentPath = fileURLToPath(
    new URL("../.env.local", import.meta.url),
  );
  const contents = readFileSync(environmentPath, "utf8");
  const replacement = `SENSO_POLICY_BINDINGS=${JSON.stringify([indexedBinding])}`;
  if (!/^SENSO_POLICY_BINDINGS=.*$/m.test(contents)) {
    throw new Error("SENSO_POLICY_BINDINGS is missing from .env.local");
  }
  const updated = contents.replace(/^SENSO_POLICY_BINDINGS=.*$/m, replacement);
  const temporaryPath = `${environmentPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, updated, { flag: "wx", mode: 0o600 });
  renameSync(temporaryPath, environmentPath);
}

console.log(
  JSON.stringify(
    updateEnvironment
      ? {
          bindingUpdated: true,
          filename,
          freshUntil,
          status,
          variantCount: variants.length,
        }
      : {
          binding: indexedBinding,
          bindingJson: JSON.stringify([indexedBinding]),
          filename,
          status,
          variantCount: variants.length,
        },
  ),
);
