import { describe, expect, it } from "vitest";

import {
  pravaCustomerEmailSchema,
  pravaMerchantOriginSchema,
  toPravaMerchantOrigin,
} from "./contract";

describe("Prava provider-boundary identifiers", () => {
  it.each([
    "user@acme.local",
    "user@acme.test",
    "user@acme.example",
    "user@acme.demo",
    "user@acme.invalid",
    "user@localhost",
    "user@acme.internal",
    "user@acme.devices",
    "user@agentic-commerce.nep",
  ])("rejects a non-routable customer email: %s", (email) => {
    expect(pravaCustomerEmailSchema.safeParse(email).success).toBe(false);
  });

  it("accepts an email on a delegated domain", () => {
    expect(pravaCustomerEmailSchema.parse("demo@example.com")).toBe(
      "demo@example.com",
    );
  });

  it.each([
    "htttps://zara.com",
    "www.acme.com",
    "http://www.acme.com",
    "https://www.airshop.demo",
    "https://demo.agentic-commerce.nep",
    "https://deathwishcoffee.com/products/grey-tumbler",
    "https://www.acme.com/?campaign=demo",
  ])("rejects a malformed or non-origin merchant URL: %s", (url) => {
    expect(pravaMerchantOriginSchema.safeParse(url).success).toBe(false);
  });

  it("accepts a bare HTTPS origin on a delegated domain", () => {
    expect(pravaMerchantOriginSchema.parse("https://www.bonescoffee.com")).toBe(
      "https://www.bonescoffee.com",
    );
  });

  it("projects a verified product URL to the bare origin sent to Prava", () => {
    expect(
      toPravaMerchantOrigin(
        "https://www.bonescoffee.com/products/bones-coffee-company-gift-card",
      ),
    ).toBe("https://www.bonescoffee.com");
  });
});
