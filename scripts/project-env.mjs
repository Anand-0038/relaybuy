import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultEnvironmentPath = fileURLToPath(
  new URL("../.env.local", import.meta.url),
);

export const DEFAULT_PROTECTED_ENVIRONMENT_NAMES = [
  "ALLOW_PRAVA_LIVE_ORDER",
  "ALLOW_PRAVA_SESSION_CREATION",
  "APPROVAL_TOKEN_PEPPER",
  "DATABASE_URL",
  "MERCHANT_SECRET_KEY",
  "OPENAI_API_KEY",
  "PAYMENTS_ENABLED",
  "PRAVA_MERCHANT_SECRET_KEY",
  "PRAVA_MODE",
  "SENSO_API_KEY",
  "SENSO_POLICY_BINDINGS",
];

export class ProjectEnvironmentError extends Error {
  constructor(conflictingNames) {
    super(
      `Project environment conflicts with ambient values: ${conflictingNames.join(", ")}`,
    );
    this.name = "ProjectEnvironmentError";
    this.conflictingNames = conflictingNames;
  }
}

export function parseProjectEnvironment(path) {
  const values = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/,
    );
    if (!match) continue;

    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    values.set(match[1], value);
  }
  return values;
}

export function loadProjectEnvironment({
  ambient = process.env,
  path,
  projectDir,
  protectedNames = DEFAULT_PROTECTED_ENVIRONMENT_NAMES,
} = {}) {
  const environmentPath = resolve(
    path ??
      ambient.RELAYBUY_PROJECT_ENV_FILE ??
      (projectDir ? join(projectDir, ".env.local") : defaultEnvironmentPath),
  );
  const values = parseProjectEnvironment(environmentPath);
  const conflicts = protectedNames
    .filter(
      (name) =>
        ambient[name] !== undefined &&
        values.has(name) &&
        ambient[name] !== values.get(name),
    )
    .sort();
  if (conflicts.length > 0) {
    throw new ProjectEnvironmentError(conflicts);
  }

  const environment = { ...ambient };
  for (const [name, value] of values) {
    environment[name] = value;
    ambient[name] = value;
  }

  const workspacePath = resolve(dirname(environmentPath), "..", ".env");
  const workspaceValues = existsSync(workspacePath)
    ? parseProjectEnvironment(workspacePath)
    : new Map();
  const workspaceConflicts = protectedNames
    .filter(
      (name) =>
        values.has(name) &&
        workspaceValues.has(name) &&
        values.get(name) !== workspaceValues.get(name),
    )
    .sort();

  return {
    environment,
    path: environmentPath,
    values,
    workspaceConflicts,
  };
}
