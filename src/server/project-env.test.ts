import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ProjectEnvironmentError,
  loadProjectEnvironment,
} from "../../scripts/project-env.mjs";

function fixture(local: string, workspace = ""): string {
  const root = mkdtempSync(join(tmpdir(), "relaybuy-env-"));
  const project = join(root, "relaybuy");
  mkdirSync(project);
  writeFileSync(join(project, ".env.local"), local);
  writeFileSync(join(root, ".env"), workspace);
  return project;
}

describe("project environment source", () => {
  it("loads the project .env.local without inheriting the workspace env", () => {
    const projectDir = fixture(
      "PRAVA_MERCHANT_SECRET_KEY=sk_test_project\nPRAVA_MODE=replay\n",
      "PRAVA_MERCHANT_SECRET_KEY=sk_test_workspace\n",
    );

    const result = loadProjectEnvironment({ ambient: {}, projectDir });

    expect(result.environment.PRAVA_MERCHANT_SECRET_KEY).toBe(
      "sk_test_project",
    );
    expect(result.workspaceConflicts).toEqual(["PRAVA_MERCHANT_SECRET_KEY"]);
  });

  it("rejects conflicting ambient credentials without exposing values", () => {
    const projectDir = fixture(
      "PRAVA_MERCHANT_SECRET_KEY=sk_test_project\nOPENAI_API_KEY=project-openai-key\n",
    );

    let caught: unknown;
    try {
      loadProjectEnvironment({
        ambient: {
          OPENAI_API_KEY: "ambient-openai-key",
          PRAVA_MERCHANT_SECRET_KEY: "sk_test_ambient",
        },
        projectDir,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectEnvironmentError);
    expect(caught).toMatchObject({
      conflictingNames: ["OPENAI_API_KEY", "PRAVA_MERCHANT_SECRET_KEY"],
    });
    expect(String(caught)).not.toContain("project-openai-key");
    expect(String(caught)).not.toContain("ambient-openai-key");
    expect(String(caught)).not.toContain("sk_test_project");
    expect(String(caught)).not.toContain("sk_test_ambient");
  });

  it("accepts an ambient protected value only when it matches .env.local", () => {
    const projectDir = fixture("PRAVA_MERCHANT_SECRET_KEY=sk_test_project\n");

    const result = loadProjectEnvironment({
      ambient: { PRAVA_MERCHANT_SECRET_KEY: "sk_test_project" },
      projectDir,
    });

    expect(result.environment.PRAVA_MERCHANT_SECRET_KEY).toBe(
      "sk_test_project",
    );
  });
});
