import { describe, expect, it } from "vitest";

import { sandboxArmFailures } from "../../scripts/sandbox-arm-check.mjs";

const armedEnvironment = {
  ALLOW_PRAVA_LIVE_ORDER: "false",
  ALLOW_PRAVA_SESSION_CREATION: "true",
  APP_BASE_URL: "http://localhost:3000",
  APPROVAL_TOKEN_PEPPER: "p".repeat(32),
  DATABASE_URL: "postgres://configured",
  PAYMENTS_ENABLED: "true",
  PRAVA_ENV: "sandbox",
  PRAVA_MERCHANT_SECRET_KEY: `sk_${"test_configured"}`,
  PRAVA_MODE: "sandbox",
  RELAYBUY_CHECKOUT_ADDRESS1: "1 Test Street",
  RELAYBUY_CHECKOUT_CARDHOLDER_NAME: "Test User",
  RELAYBUY_CHECKOUT_CITY: "Test City",
  RELAYBUY_CHECKOUT_COUNTRY_CODE: "US",
  RELAYBUY_CHECKOUT_EMAIL: "test@example.com",
  RELAYBUY_CHECKOUT_FIRST_NAME: "Test",
  RELAYBUY_CHECKOUT_LAST_NAME: "User",
  RELAYBUY_CHECKOUT_POSTAL_CODE: "10001",
  RELAYBUY_CHECKOUT_REGION: "New York",
  RELAYBUY_MERCHANT_ATTEMPT_ENABLED: "true",
  REPLAY_MUTATIONS_ENABLED: "false",
  SENSO_POLICY_BINDINGS: '[{"contentId":"configured"}]',
};

describe("sandbox arm check", () => {
  it("accepts only the explicit one-run sandbox configuration", () => {
    expect(sandboxArmFailures(armedEnvironment)).toEqual([]);
  });

  it("reports safe names rather than values for missing private data", () => {
    const failures = sandboxArmFailures({
      ...armedEnvironment,
      RELAYBUY_CHECKOUT_ADDRESS1: "",
    });

    expect(failures).toContain("RELAYBUY_CHECKOUT_ADDRESS1 is missing");
  });

  it("rejects live ordering and non-sandbox credentials", () => {
    const failures = sandboxArmFailures({
      ...armedEnvironment,
      ALLOW_PRAVA_LIVE_ORDER: "true",
      PRAVA_MERCHANT_SECRET_KEY: "sk_live_forbidden",
    });

    expect(failures).toContain("ALLOW_PRAVA_LIVE_ORDER must equal false");
    expect(failures).toContain(
      "PRAVA_MERCHANT_SECRET_KEY must be a sandbox sk_test_ key",
    );
  });

  it("rejects arming while an incident pause is active", () => {
    expect(
      sandboxArmFailures({
        ...armedEnvironment,
        RELAYBUY_PAYMENT_PAUSE_REASON: "PRAVA_UNKNOWN_OUTCOME",
      }),
    ).toContain(
      "RELAYBUY_PAYMENT_PAUSE_REASON must be empty before sandbox arming",
    );
  });

  it("rejects non-routable emails and invalid cardholder names", () => {
    const failures = sandboxArmFailures({
      ...armedEnvironment,
      RELAYBUY_CHECKOUT_CARDHOLDER_NAME: "1234",
      RELAYBUY_CHECKOUT_EMAIL: "demo@relaybuy.local",
    });

    expect(failures).toContain(
      "RELAYBUY_CHECKOUT_EMAIL must use a publicly delegated domain",
    );
    expect(failures).toContain(
      "RELAYBUY_CHECKOUT_CARDHOLDER_NAME must contain a valid alphabetic name",
    );
  });

  it("requires a local ceremony origin", () => {
    expect(
      sandboxArmFailures({
        ...armedEnvironment,
        APP_BASE_URL: "https://relaybuy.example",
      }),
    ).toContain("APP_BASE_URL must use HTTP on a loopback host");
  });

  it("requires a non-empty policy binding and an ISO country code", () => {
    const failures = sandboxArmFailures({
      ...armedEnvironment,
      RELAYBUY_CHECKOUT_COUNTRY_CODE: "India",
      SENSO_POLICY_BINDINGS: "[]",
    });

    expect(failures).toContain(
      "SENSO_POLICY_BINDINGS must contain a bound policy record",
    );
    expect(failures).toContain(
      "RELAYBUY_CHECKOUT_COUNTRY_CODE must be two uppercase letters",
    );
  });
});
