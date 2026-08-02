import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProjectEnvironmentError,
  loadProjectEnvironment,
} from "./project-env.mjs";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const requiredCheckoutNames = [
  "RELAYBUY_CHECKOUT_EMAIL",
  "RELAYBUY_CHECKOUT_CARDHOLDER_NAME",
  "RELAYBUY_CHECKOUT_FIRST_NAME",
  "RELAYBUY_CHECKOUT_LAST_NAME",
  "RELAYBUY_CHECKOUT_ADDRESS1",
  "RELAYBUY_CHECKOUT_CITY",
  "RELAYBUY_CHECKOUT_REGION",
  "RELAYBUY_CHECKOUT_POSTAL_CODE",
  "RELAYBUY_CHECKOUT_COUNTRY_CODE",
];

const protectedNames = [
  "ALLOW_PRAVA_LIVE_ORDER",
  "ALLOW_PRAVA_SESSION_CREATION",
  "APPROVAL_TOKEN_PEPPER",
  "APP_BASE_URL",
  "DATABASE_URL",
  "PAYMENTS_ENABLED",
  "PRAVA_ENV",
  "PRAVA_MERCHANT_SECRET_KEY",
  "PRAVA_MODE",
  "RELAYBUY_MERCHANT_ATTEMPT_ENABLED",
  "RELAYBUY_PAYMENT_PAUSE_REASON",
  "REPLAY_MUTATIONS_ENABLED",
  "SENSO_POLICY_BINDINGS",
  ...requiredCheckoutNames,
];

const expectedFlags = {
  ALLOW_PRAVA_LIVE_ORDER: "false",
  ALLOW_PRAVA_SESSION_CREATION: "true",
  PAYMENTS_ENABLED: "true",
  PRAVA_ENV: "sandbox",
  PRAVA_MODE: "sandbox",
  RELAYBUY_MERCHANT_ATTEMPT_ENABLED: "true",
  REPLAY_MUTATIONS_ENABLED: "false",
};

const requiredNames = [
  "APP_BASE_URL",
  "APPROVAL_TOKEN_PEPPER",
  "DATABASE_URL",
  "SENSO_POLICY_BINDINGS",
  ...requiredCheckoutNames,
];

export function sandboxArmFailures(environment) {
  const failures = [];

  for (const [name, expected] of Object.entries(expectedFlags)) {
    if (environment[name] !== expected) {
      failures.push(`${name} must equal ${expected}`);
    }
  }

  if (!environment.PRAVA_MERCHANT_SECRET_KEY?.startsWith("sk_test_")) {
    failures.push("PRAVA_MERCHANT_SECRET_KEY must be a sandbox sk_test_ key");
  }

  if (environment.RELAYBUY_PAYMENT_PAUSE_REASON?.trim()) {
    failures.push(
      "RELAYBUY_PAYMENT_PAUSE_REASON must be empty before sandbox arming",
    );
  }

  for (const name of requiredNames) {
    if (!environment[name]?.trim()) {
      failures.push(`${name} is missing`);
    }
  }

  try {
    const appBaseUrl = new URL(environment.APP_BASE_URL ?? "");
    if (
      appBaseUrl.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(appBaseUrl.hostname)
    ) {
      failures.push("APP_BASE_URL must use HTTP on a loopback host");
    }
  } catch {
    failures.push("APP_BASE_URL must be a valid URL");
  }

  try {
    const bindings = JSON.parse(environment.SENSO_POLICY_BINDINGS ?? "");
    if (!Array.isArray(bindings) || bindings.length === 0) {
      failures.push("SENSO_POLICY_BINDINGS must contain a bound policy record");
    }
  } catch {
    failures.push("SENSO_POLICY_BINDINGS must be valid JSON");
  }

  if (
    environment.RELAYBUY_CHECKOUT_COUNTRY_CODE &&
    !/^[A-Z]{2}$/.test(environment.RELAYBUY_CHECKOUT_COUNTRY_CODE)
  ) {
    failures.push(
      "RELAYBUY_CHECKOUT_COUNTRY_CODE must be two uppercase letters",
    );
  }

  return failures;
}

export function runSandboxArmCheck() {
  let loaded;
  try {
    loaded = loadProjectEnvironment({ projectDir, protectedNames });
  } catch (error) {
    if (error instanceof ProjectEnvironmentError) {
      console.error(
        `Sandbox arm check stopped because ambient values conflict for: ${error.conflictingNames.join(", ")}`,
      );
      return 78;
    }
    throw error;
  }

  if (loaded.workspaceConflicts.length > 0) {
    console.warn(
      `Ignoring conflicting workspace-root values for: ${loaded.workspaceConflicts.join(", ")}. RelayBuy uses .env.local only.`,
    );
  }

  const failures = sandboxArmFailures(loaded.environment);
  if (failures.length > 0) {
    console.error("Sandbox runtime is not safely armed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    return 1;
  }

  console.log("Sandbox runtime is safely armed for one controlled run.");
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runSandboxArmCheck();
}
