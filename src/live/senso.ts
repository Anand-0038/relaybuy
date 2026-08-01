import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getLiveEnvironment } from "./env";
import { resolveSharedStructuredAuthorization } from "./evidence-record";
import {
  buildMerchantEvidenceQuery,
  buildVariantEvidenceQuery,
} from "./senso-queries";
import {
  evidenceBundleSchema,
  type EvidenceBundle,
  type PurchaseIntent,
  type VerifiedMerchantOffer,
} from "./types";

const sensoResultSchema = z
  .object({
    chunk_index: z.number().int().nonnegative(),
    chunk_text: z.string().min(1),
    content_id: z.string().min(1),
    content_type: z.string().optional(),
    rank: z.number().int().positive(),
    score: z.number().min(0).max(1),
    source_type: z.string().default("knowledge_base"),
    title: z.string().min(1),
    version_id: z.string().nullable().optional(),
  })
  .passthrough();

const sensoSearchResponseSchema = z
  .object({
    answer: z.string().default(""),
    results: z.array(sensoResultSchema),
  })
  .passthrough();

async function searchSenso(
  kind: "merchant" | "variant",
  query: string,
): Promise<EvidenceBundle["merchant"]> {
  const environment = getLiveEnvironment();
  const response = await fetch(`${environment.SENSO_BASE_URL}/org/search`, {
    body: JSON.stringify({ max_results: 8, query }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": environment.SENSO_API_KEY,
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Senso search failed with status ${response.status}`);
  }

  const parsed = sensoSearchResponseSchema.parse(await response.json());
  return {
    answer: parsed.answer,
    citations: parsed.results.map((result) => ({
      chunkIndex: result.chunk_index,
      chunkText: result.chunk_text,
      contentId: result.content_id,
      id: randomUUID(),
      rank: result.rank,
      score: result.score,
      sourceType: result.source_type,
      title: result.title,
      versionId: result.version_id ?? null,
    })),
    kind,
    query,
  };
}

export async function resolvePurchaseEvidence(
  intent: PurchaseIntent,
  offer: VerifiedMerchantOffer,
): Promise<EvidenceBundle> {
  const merchantDomain = new URL(offer.merchantUrl).hostname;

  const [merchant, variant] = await Promise.all([
    searchSenso(
      "merchant",
      buildMerchantEvidenceQuery({
        merchantDomain,
        merchantName: offer.merchantName,
        productName: offer.productName,
      }),
    ),
    searchSenso(
      "variant",
      buildVariantEvidenceQuery({
        merchantDomain,
        merchantName: offer.merchantName,
        productName: offer.productName,
        quotedColor: offer.quotedColor,
        quotedSize: offer.quotedSize,
        requestedProduct: intent.requestedProduct ?? null,
        sku: offer.sku,
      }),
    ),
  ]);

  const authorization = resolveSharedStructuredAuthorization(
    [merchant.citations, variant.citations],
    getLiveEnvironment().SENSO_POLICY_BINDINGS,
  );

  return evidenceBundleSchema.parse({
    authorization,
    merchant,
    retrievedAt: new Date().toISOString(),
    variant,
  });
}
