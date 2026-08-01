import { z } from "zod";

import { normalizeOptionTuple } from "./options";

const variantSchema = z
  .object({
    options: z.record(z.string(), z.string()),
    quantity: z.number().int().positive(),
  })
  .strict();

export const variantDecisionInputSchema = z
  .object({
    requested: variantSchema,
    candidate: variantSchema,
    evidenceIds: z.array(z.string().trim().min(1)),
  })
  .strict();

export type VariantDecisionInput = z.input<typeof variantDecisionInputSchema>;

export type VariantDecision =
  | {
      status: "approved";
      reasonCode: "VARIANT_MATCH";
      requestedOptions: Record<string, string>;
      candidateOptions: Record<string, string>;
      quantity: number;
      evidenceIds: string[];
    }
  | {
      status: "rejected";
      reasonCode: "SIZE_MISMATCH" | "COLOR_MISMATCH" | "VARIANT_MISMATCH";
      optionKey: string;
      requestedValue: string;
      candidateValue: string;
      evidenceIds: string[];
    }
  | {
      status: "rejected";
      reasonCode: "QUANTITY_MISMATCH";
      requestedQuantity: number;
      candidateQuantity: number;
      evidenceIds: string[];
    }
  | {
      status: "unknown";
      reasonCode: "MISSING_CANDIDATE_OPTION" | "EVIDENCE_MISSING";
      missingFields: string[];
      evidenceIds: string[];
    };

function mismatchReason(
  optionKey: string,
): "SIZE_MISMATCH" | "COLOR_MISMATCH" | "VARIANT_MISMATCH" {
  if (optionKey === "size") {
    return "SIZE_MISMATCH";
  }

  if (optionKey === "color") {
    return "COLOR_MISMATCH";
  }

  return "VARIANT_MISMATCH";
}

export function evaluateVariant(input: VariantDecisionInput): VariantDecision {
  const validInput = variantDecisionInputSchema.parse(input);
  const requestedOptions = normalizeOptionTuple(validInput.requested.options);
  const candidateOptions = normalizeOptionTuple(validInput.candidate.options);

  if (validInput.evidenceIds.length === 0) {
    return {
      status: "unknown",
      reasonCode: "EVIDENCE_MISSING",
      missingFields: ["evidenceIds"],
      evidenceIds: [],
    };
  }

  const missingFields = Object.keys(requestedOptions)
    .filter((key) => candidateOptions[key] === undefined)
    .map((key) => `candidate.options.${key}`);

  if (missingFields.length > 0) {
    return {
      status: "unknown",
      reasonCode: "MISSING_CANDIDATE_OPTION",
      missingFields,
      evidenceIds: validInput.evidenceIds,
    };
  }

  for (const [optionKey, requestedValue] of Object.entries(requestedOptions)) {
    const candidateValue = candidateOptions[optionKey]!;

    if (candidateValue !== requestedValue) {
      return {
        status: "rejected",
        reasonCode: mismatchReason(optionKey),
        optionKey,
        requestedValue,
        candidateValue,
        evidenceIds: validInput.evidenceIds,
      };
    }
  }

  if (validInput.requested.quantity !== validInput.candidate.quantity) {
    return {
      status: "rejected",
      reasonCode: "QUANTITY_MISMATCH",
      requestedQuantity: validInput.requested.quantity,
      candidateQuantity: validInput.candidate.quantity,
      evidenceIds: validInput.evidenceIds,
    };
  }

  return {
    status: "approved",
    reasonCode: "VARIANT_MATCH",
    requestedOptions,
    candidateOptions,
    quantity: validInput.requested.quantity,
    evidenceIds: validInput.evidenceIds,
  };
}
