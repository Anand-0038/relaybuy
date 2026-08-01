interface MerchantEvidenceQueryInput {
  merchantDomain: string;
  merchantName: string;
  productName: string;
}

interface VariantEvidenceQueryInput extends MerchantEvidenceQueryInput {
  quotedColor: string;
  quotedSize: string;
  requestedProduct: string | null;
  sku: string;
}

export function buildMerchantEvidenceQuery(
  input: MerchantEvidenceQueryInput,
): string {
  return [
    "Find the allowed merchant policy record for exact merchant name",
    `"${input.merchantName}" and exact domain "${input.merchantDomain}".`,
    `Is "${input.merchantName}" explicitly approved for purchasing "${input.productName}"?`,
    "Return only source-backed evidence and do not infer approval.",
  ].join(" ");
}

export function buildVariantEvidenceQuery(
  input: VariantEvidenceQueryInput,
): string {
  return [
    "Using only the RelayBuy knowledge base, provide source-backed evidence",
    `for exact merchant domain "${input.merchantDomain}", product "${input.productName}", SKU "${input.sku}",`,
    `option "${input.quotedColor}", and type "${input.quotedSize}".`,
    `The user's requested product was "${input.requestedProduct ?? "unspecified"}".`,
    "Do not substitute a similar variant.",
  ].join(" ");
}
