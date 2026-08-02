import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProjectEnvironmentError,
  loadProjectEnvironment,
} from "./project-env.mjs";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let loaded;
try {
  loaded = loadProjectEnvironment({ projectDir });
} catch (error) {
  if (error instanceof ProjectEnvironmentError) {
    console.error(
      `Connected preflight stopped before network access because ambient values conflict for: ${error.conflictingNames.join(", ")}`,
    );
    process.exit(78);
  }
  throw error;
}

if (loaded.workspaceConflicts.length > 0) {
  console.warn(
    `Ignoring conflicting workspace-root credentials for: ${loaded.workspaceConflicts.join(", ")}. RelayBuy uses .env.local only.`,
  );
}

const childEnvironment = { ...process.env, RUN_CONNECTED_PREFLIGHT: "true" };
if (
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.https_proxy ||
  process.env.http_proxy
) {
  childEnvironment.NODE_USE_ENV_PROXY = "1";
}

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "vitest",
    "run",
    "src/live/__tests__/readiness.integration.test.ts",
    "--reporter=verbose",
  ],
  {
    cwd: projectDir,
    env: childEnvironment,
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error(`Unable to start connected preflight: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Connected preflight terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
