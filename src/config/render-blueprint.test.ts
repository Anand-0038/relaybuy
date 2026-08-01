import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function renderBlueprint(): string {
  const path = resolve(process.cwd(), "render.yaml");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("Render deployment policy", () => {
  it("defines a manually deployed web service with a health check and custom domain", () => {
    const blueprint = renderBlueprint();

    expect(blueprint).toContain("type: web");
    expect(blueprint).toContain("runtime: node");
    expect(blueprint).toContain("plan: free");
    expect(blueprint).toContain('generation: "off"');
    expect(blueprint).toContain('autoDeployTrigger: "off"');
    expect(blueprint).toContain("healthCheckPath: /api/health");
    expect(blueprint).toContain("npm start -- -H 0.0.0.0 -p $PORT");
    expect(blueprint).toContain("relaybuy.a2zbtc.com");
  });

  it("keeps every payment capability disabled in the synced deployment", () => {
    const blueprint = renderBlueprint();

    for (const key of [
      "PAYMENTS_ENABLED",
      "ALLOW_PRAVA_SESSION_CREATION",
      "ALLOW_PRAVA_LIVE_ORDER",
      "PRAVA_MCP_CONTRACT_CONFIRMED",
      "RELAYBUY_MERCHANT_ATTEMPT_ENABLED",
    ]) {
      expect(blueprint).toMatch(
        new RegExp(`key: ${key}\\n\\s+value: \"false\"`),
      );
    }
    expect(blueprint).toMatch(/key: PRAVA_MODE\n\s+value: replay/);
    expect(blueprint).toMatch(/key: TRUST_PROXY_HEADERS\n\s+value: "false"/);
  });

  it("references the existing database and never embeds provider secrets", () => {
    const blueprint = renderBlueprint();

    expect(blueprint).toContain("name: relaybuy-hackathon-db");
    expect(blueprint).toContain("property: connectionString");
    expect(blueprint).toMatch(
      /key: APPROVAL_TOKEN_PEPPER\n\s+generateValue: true/,
    );
    expect(blueprint).toMatch(
      /key: READINESS_PROBE_TOKEN\n\s+generateValue: true/,
    );
    for (const key of [
      "OPENAI_API_KEY",
      "PRAVA_MERCHANT_SECRET_KEY",
      "SENSO_API_KEY",
      "SENSO_POLICY_BINDINGS",
    ]) {
      expect(blueprint).toMatch(new RegExp(`key: ${key}\\n\\s+sync: false`));
    }
    expect(blueprint).not.toMatch(/(?:sk_test_|postgres(?:ql)?:\/\/)/);
  });
});
