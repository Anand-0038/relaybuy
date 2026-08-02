import { loadProjectEnvironment } from "./project-env.mjs";
import { extractPolicyBindings } from "./senso-record.mjs";
import {
  buildMerchantEvidenceQuery,
  buildVariantEvidenceQuery,
} from "../src/live/senso-queries.ts";

loadProjectEnvironment({ protectedNames: ["SENSO_API_KEY"] });

const apiKey = process.env.SENSO_API_KEY;
const baseUrl = process.env.SENSO_BASE_URL ?? "https://apiv2.senso.ai/api/v1";
if (!apiKey) throw new Error("SENSO_API_KEY is required");

const queryInput = {
  merchantDomain: "www.bonescoffee.com",
  merchantName: "Bones Coffee Company",
  productName: "Gift Card",
  quotedColor: "$10.00 e-gift card",
  quotedSize: "Digital gift card",
  requestedProduct: "$10 Bones Coffee e-gift card",
  sku: "25933838657",
};

const queries = [
  buildMerchantEvidenceQuery(queryInput),
  buildVariantEvidenceQuery(queryInput),
];

const bindingGroups = [];
for (const query of queries) {
  const response = await fetch(`${baseUrl}/org/search`, {
    body: JSON.stringify({ max_results: 50, query }),
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Senso runtime verification returned ${response.status}`);
  }
  const search = await response.json();
  bindingGroups.push(extractPolicyBindings(search.results ?? []));
}

const configuredBindings = JSON.parse(
  process.env.SENSO_POLICY_BINDINGS ?? "[]",
);
const shared = bindingGroups[0].find(
  (candidate) =>
    configuredBindings.some(
      (configured) =>
        configured.contentId === candidate.binding.contentId &&
        configured.versionId === candidate.binding.versionId &&
        configured.recordDigest === candidate.binding.recordDigest,
    ) &&
    bindingGroups[1].some(
      (other) =>
        other.binding.contentId === candidate.binding.contentId &&
        other.binding.versionId === candidate.binding.versionId &&
        other.binding.recordDigest === candidate.binding.recordDigest,
    ),
);
if (!shared) {
  throw new Error(
    "The two exact Senso queries did not return the same immutable policy record",
  );
}
if (Date.now() > Date.parse(shared.freshUntil)) {
  throw new Error("The shared immutable Senso policy record is expired");
}

console.log(
  JSON.stringify({
    bindingJson: JSON.stringify([shared.binding]),
    freshUntil: shared.freshUntil,
    queryCount: queries.length,
    status: "ready",
  }),
);
