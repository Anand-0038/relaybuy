import { parseRuntimeConfig } from "@/config/runtime";
import { pravaCustomerEmailSchema } from "@/integrations/prava/contract";

const checkoutProfileNames = [
  "RELAYBUY_CHECKOUT_EMAIL",
  "RELAYBUY_CHECKOUT_CARDHOLDER_NAME",
  "RELAYBUY_CHECKOUT_FIRST_NAME",
  "RELAYBUY_CHECKOUT_LAST_NAME",
  "RELAYBUY_CHECKOUT_ADDRESS1",
  "RELAYBUY_CHECKOUT_CITY",
  "RELAYBUY_CHECKOUT_REGION",
  "RELAYBUY_CHECKOUT_POSTAL_CODE",
  "RELAYBUY_CHECKOUT_COUNTRY_CODE",
] as const;

export type SandboxPaymentAvailability =
  | {
      enabled: false;
      reason:
        | "CHECKOUT_PROFILE_MISSING"
        | "PAYMENT_DISABLED"
        | "UNKNOWN_OUTCOME_PAUSE";
      message: string;
    }
  | {
      enabled: true;
      reason: "READY";
      message: string;
    };

export function getPravaSessionNotCreatedMessage(
  availability: SandboxPaymentAvailability,
): string {
  return availability.enabled
    ? "Manager approval must complete before RelayBuy can create one sandbox session."
    : availability.message;
}

export function getSandboxPaymentAvailability(
  environment: Record<string, string | undefined>,
): SandboxPaymentAvailability {
  if (environment.RELAYBUY_PAYMENT_PAUSE_REASON === "PRAVA_UNKNOWN_OUTCOME") {
    return {
      enabled: false,
      message:
        "Sandbox payment is paused because a prior Prava session-create outcome is unknown. Do not create another approval or session until Prava confirms whether it received that request.",
      reason: "UNKNOWN_OUTCOME_PAUSE",
    };
  }

  const runtime = parseRuntimeConfig(environment);
  if (
    runtime.mode !== "sandbox" ||
    !runtime.paymentsEnabled ||
    !runtime.sessionCreationEnabled
  ) {
    return {
      enabled: false,
      message:
        "Sandbox session creation is disabled in this runtime. This environment proves pre-payment controls only; approval does not create a Prava order.",
      reason: "PAYMENT_DISABLED",
    };
  }

  const cardholderName =
    environment.RELAYBUY_CHECKOUT_CARDHOLDER_NAME?.trim() ?? "";
  const checkoutReady =
    environment.RELAYBUY_MERCHANT_ATTEMPT_ENABLED === "true" &&
    checkoutProfileNames.every((name) => Boolean(environment[name]?.trim())) &&
    pravaCustomerEmailSchema.safeParse(environment.RELAYBUY_CHECKOUT_EMAIL)
      .success &&
    /^[\p{L}][\p{L} .'-]*$/u.test(cardholderName);
  if (!checkoutReady) {
    return {
      enabled: false,
      message:
        "Merchant checkout readiness is incomplete. Configure the private checkout profile before creating one limited sandbox session; no request has been sent to Prava.",
      reason: "CHECKOUT_PROFILE_MISSING",
    };
  }

  return {
    enabled: true,
    message:
      "Sandbox session creation and the constrained merchant attempt are armed for this runtime.",
    reason: "READY",
  };
}
