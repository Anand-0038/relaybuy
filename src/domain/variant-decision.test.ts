import { describe, expect, it } from "vitest";

import { evaluateVariant } from "./variant-decision";

const baseInput = {
  requested: {
    options: { color: "black", size: "small" },
    quantity: 2,
  },
  candidate: {
    options: { color: "Black", size: "Small" },
    quantity: 2,
  },
  evidenceIds: ["replay-evidence-variant-001"],
};

describe("evaluateVariant", () => {
  it("approves the normalized requested variant tuple", () => {
    expect(evaluateVariant(baseInput)).toEqual({
      status: "approved",
      reasonCode: "VARIANT_MATCH",
      requestedOptions: { color: "black", size: "small" },
      candidateOptions: { color: "black", size: "small" },
      quantity: 2,
      evidenceIds: ["replay-evidence-variant-001"],
    });
  });

  it.each([
    ["size", "medium", "SIZE_MISMATCH"],
    ["color", "navy", "COLOR_MISMATCH"],
  ] as const)(
    "rejects a %s mismatch with a typed reason",
    (key, value, reasonCode) => {
      const candidate = structuredClone(baseInput.candidate);
      candidate.options[key] = value;

      expect(evaluateVariant({ ...baseInput, candidate })).toMatchObject({
        status: "rejected",
        reasonCode,
        optionKey: key,
        requestedValue: baseInput.requested.options[key],
        candidateValue: value,
      });
    },
  );

  it("rejects a quantity mismatch", () => {
    expect(
      evaluateVariant({
        ...baseInput,
        candidate: { ...baseInput.candidate, quantity: 3 },
      }),
    ).toMatchObject({
      status: "rejected",
      reasonCode: "QUANTITY_MISMATCH",
      requestedQuantity: 2,
      candidateQuantity: 3,
    });
  });

  it("fails unknown when the candidate omits a requested option", () => {
    expect(
      evaluateVariant({
        ...baseInput,
        candidate: {
          options: { color: "black" },
          quantity: 2,
        },
      }),
    ).toEqual({
      status: "unknown",
      reasonCode: "MISSING_CANDIDATE_OPTION",
      missingFields: ["candidate.options.size"],
      evidenceIds: ["replay-evidence-variant-001"],
    });
  });

  it("fails unknown without evidence", () => {
    expect(
      evaluateVariant({
        ...baseInput,
        evidenceIds: [],
      }),
    ).toEqual({
      status: "unknown",
      reasonCode: "EVIDENCE_MISSING",
      missingFields: ["evidenceIds"],
      evidenceIds: [],
    });
  });
});
