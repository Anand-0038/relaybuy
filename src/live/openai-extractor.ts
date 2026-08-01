import "server-only";

import { Agent, run } from "@openai/agents";

import { getLiveEnvironment } from "./env";
import {
  classifyOpenAiExtractionError,
  classifyOpenAiExtractionFailureCode,
  type OpenAiExtractionFailureCode,
} from "./openai-retry";
import { purchaseIntentSchema, type PurchaseIntent } from "./types";

const extractionInstructions = `
You extract purchase intent for a trust-first procurement workflow.
Return only the provided structured output.

Rules:
- Never approve, recommend, or initiate payment.
- Extract only facts requested or preferred by the user.
- Never supply a merchant URL, SKU, quoted variant, price, fee, or total.
- Those commerce facts come only from RelayBuy's merchant adapter.
- Monetary values are integer minor units (for USD, cents).
- Use null for information that is genuinely absent.
- Add every absent hard field to missingFields.
- Hard fields are requestedProduct, requestedColor, requestedSize, quantity,
  budgetMinor, and currency.
- requestedColor means the exact primary variant option requested by the user,
  even when that option is not literally a color. For the locked gift-card
  flow, put the requested denomination (for example, "$10.00") here.
- requestedSize means the exact secondary form or type requested by the user,
  even when it is not a physical size. For the locked gift-card flow, put
  "E-gift card" here when the user requests an e-gift card.
- preferredMerchant is a user preference only, never an authorization fact.
- approvedMerchantOnly is true only when the user requires an approved or
  trusted merchant.
- Confidence is 0 to 1 and reflects extraction certainty, not purchase safety.
`.trim();

async function retryDelay(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500));
}

export class LiveOpenAiExtractionError extends Error {
  constructor(
    public readonly code: OpenAiExtractionFailureCode,
    options?: ErrorOptions,
  ) {
    super("OpenAI extraction failed closed", options);
    this.name = "LiveOpenAiExtractionError";
  }
}

export async function extractPurchaseIntent(
  requestText: string,
): Promise<{ intent: PurchaseIntent; model: string }> {
  const environment = getLiveEnvironment();
  const models = [
    ...new Set([environment.OPENAI_MODEL, environment.OPENAI_FALLBACK_MODEL]),
  ];

  for (const [index, model] of models.entries()) {
    const agent = new Agent({
      instructions: extractionInstructions,
      model,
      name: "RelayBuy Purchase Intent Extractor",
      outputType: purchaseIntentSchema,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await run(
          agent,
          `Extract this purchase request without making any purchase decision:\n\n${requestText}`,
        );
        return {
          intent: purchaseIntentSchema.parse(result.finalOutput),
          model,
        };
      } catch (error) {
        const disposition = classifyOpenAiExtractionError(error);
        if (disposition === "fallback_model" && index < models.length - 1) {
          break;
        }
        if (disposition === "retry_same_model" && attempt === 0) {
          await retryDelay();
          continue;
        }
        throw new LiveOpenAiExtractionError(
          classifyOpenAiExtractionFailureCode(error),
          { cause: error },
        );
      }
    }
  }

  throw new LiveOpenAiExtractionError("OPENAI_MODEL_UNAVAILABLE");
}
