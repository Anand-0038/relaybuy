import { describe, expect, it, vi } from "vitest";

import { inspectBonesCoffeeOffer } from "./bones-coffee";

describe("Bones Coffee live offer inspection", () => {
  it("does not follow merchant redirects during server-side revalidation", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/internal" },
      }),
    );

    await expect(inspectBonesCoffeeOffer(fetchMock)).rejects.toMatchObject({
      code: "LIVE_PRODUCT_CHANGED",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://www.bonescoffee.com/products/gift-card.js",
      ),
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
