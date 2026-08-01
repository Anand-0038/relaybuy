import { describe, expect, it, vi } from "vitest";

import {
  extractRequestWithAgent,
  extractionAgent,
  extractionOutputSchema,
  type ExtractionRunner,
} from "./extraction";

describe("RelayBuy extraction agent", () => {
  it("has no tools and therefore no payment or decision authority", () => {
    expect(extractionAgent.tools).toEqual([]);
    expect(extractionAgent.handoffs).toEqual([]);
  });

  it("requires a typed option extraction with uncertainty", () => {
    expect(
      extractionOutputSchema.parse({
        productTerms: ["staff tee"],
        requestedOptions: { color: "black" },
        quantity: 3,
        budgetMaxMinor: 9_500,
        currency: "USD",
        uncertainties: ["size"],
        confidence: 0.72,
      }),
    ).toMatchObject({
      requestedOptions: { color: "black" },
      uncertainties: ["size"],
    });
  });

  it("runs with sensitive trace data disabled", async () => {
    const run = vi.fn<ExtractionRunner["run"]>().mockResolvedValue({
      finalOutput: {
        productTerms: ["staff tee"],
        requestedOptions: { color: "black", size: "small" },
        quantity: 3,
        budgetMaxMinor: 9_500,
        currency: "USD",
        uncertainties: [],
        confidence: 0.98,
      },
    });

    await expect(
      extractRequestWithAgent(
        {
          text: "Three black small staff tees under $95.",
          attachmentDescription: "Prepared product label image.",
        },
        { run },
      ),
    ).resolves.toMatchObject({
      requestedOptions: { color: "black", size: "small" },
    });
    expect(run).toHaveBeenCalledWith(
      extractionAgent,
      expect.any(Array),
      expect.objectContaining({
        maxTurns: 2,
        traceIncludeSensitiveData: false,
      }),
    );
  });

  it("supports photo and voice attachments as multimodal extraction inputs", async () => {
    const run = vi.fn<ExtractionRunner["run"]>().mockResolvedValue({
      finalOutput: {
        productTerms: ["brother label tape"],
        requestedOptions: { color: "black", size: "small" },
        quantity: 1,
        budgetMaxMinor: 2_150,
        currency: "USD",
        uncertainties: [],
        confidence: 0.91,
      },
    });

    await extractRequestWithAgent(
      {
        text: "Need one black small Brother tape.",
        attachmentDescription: "Worker sent a photo and a voice note.",
        attachments: [
          {
            kind: "photo",
            description: "Label photo",
            mimeType: "image/jpeg",
            url: "https://images.example/photo.jpg",
          },
          {
            kind: "voice",
            description: "Voice note transcript",
            mimeType: "audio/mpeg",
            transcript: "Need a black small Brother label tape roll.",
          },
        ],
      },
      { run },
    ).then((result) => {
      expect(result.requestedOptions).toMatchObject({
        color: "black",
      });
    });

    const runInput = run.mock.calls[0]?.[1];
    expect(runInput).toMatchObject([
      {
        role: "user",
        content: expect.arrayContaining([
          expect.objectContaining({ type: "input_image", detail: "high" }),
          expect.objectContaining({ type: "input_text" }),
        ]),
      },
    ]);
  });

  it("rejects unbounded or insecure attachment inputs before model execution", async () => {
    const run = vi.fn<ExtractionRunner["run"]>();

    await expect(
      extractRequestWithAgent(
        {
          text: "Read this label.",
          attachmentDescription: "Product photo.",
          attachments: [
            {
              kind: "photo",
              description: "Label photo",
              mimeType: "image/jpeg",
              url: "http://images.example/photo.jpg",
            },
          ],
        },
        { run },
      ),
    ).rejects.toThrow();

    expect(run).not.toHaveBeenCalled();
  });
});
