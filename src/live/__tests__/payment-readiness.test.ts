import { describe, expect, it } from "vitest";

import {
  getPravaSessionNotCreatedMessage,
  getSandboxPaymentAvailability,
} from "../payment-readiness";

const safeEnvironment = {
  ALLOW_PRAVA_LIVE_ORDER: "false",
  ALLOW_PRAVA_SESSION_CREATION: "false",
  PAYMENTS_ENABLED: "false",
  PRAVA_MODE: "replay",
};

const armedEnvironment = {
  ALLOW_PRAVA_LIVE_ORDER: "false",
  ALLOW_PRAVA_SESSION_CREATION: "true",
  PAYMENTS_ENABLED: "true",
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
};

describe("sandbox payment availability", () => {
  it("explains that replay mode is a pre-payment proof environment", () => {
    const availability = getSandboxPaymentAvailability(safeEnvironment);
    expect(availability).toMatchObject({
      enabled: false,
      reason: "PAYMENT_DISABLED",
    });
    expect(availability.message).toContain(
      "approval does not create a Prava order",
    );
  });

  it("refuses to consume a session without the private checkout profile", () => {
    const availability = getSandboxPaymentAvailability({
      ...armedEnvironment,
      RELAYBUY_CHECKOUT_POSTAL_CODE: "",
    });
    expect(availability).toMatchObject({
      enabled: false,
      reason: "CHECKOUT_PROFILE_MISSING",
    });
    expect(availability.message).toContain("no request has been sent to Prava");
  });

  it("refuses a non-routable email or non-alphabetic cardholder name", () => {
    for (const environment of [
      { ...armedEnvironment, RELAYBUY_CHECKOUT_EMAIL: "demo@relaybuy.test" },
      { ...armedEnvironment, RELAYBUY_CHECKOUT_CARDHOLDER_NAME: "1234" },
    ]) {
      expect(getSandboxPaymentAvailability(environment)).toMatchObject({
        enabled: false,
        reason: "CHECKOUT_PROFILE_MISSING",
      });
    }
  });

  it("keeps every payment action paused during unknown-outcome reconciliation", () => {
    const availability = getSandboxPaymentAvailability({
      ...armedEnvironment,
      RELAYBUY_PAYMENT_PAUSE_REASON: "PRAVA_UNKNOWN_OUTCOME",
    });
    expect(availability).toMatchObject({
      enabled: false,
      reason: "UNKNOWN_OUTCOME_PAUSE",
    });
    expect(getPravaSessionNotCreatedMessage(availability)).toContain(
      "prior Prava session-create outcome is unknown",
    );
  });

  it("arms session creation only with sandbox flags and full checkout readiness", () => {
    const availability = getSandboxPaymentAvailability(armedEnvironment);
    expect(availability).toMatchObject({
      enabled: true,
      reason: "READY",
    });
    expect(getPravaSessionNotCreatedMessage(availability)).toContain(
      "Manager approval must complete",
    );
  });
});
