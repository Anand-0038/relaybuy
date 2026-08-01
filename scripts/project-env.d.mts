export const DEFAULT_PROTECTED_ENVIRONMENT_NAMES: readonly string[];

export class ProjectEnvironmentError extends Error {
  conflictingNames: string[];
}

export function parseProjectEnvironment(path: string): Map<string, string>;

export function loadProjectEnvironment(options?: {
  ambient?: Record<string, string | undefined>;
  path?: string;
  projectDir?: string;
  protectedNames?: readonly string[];
}): {
  environment: Record<string, string | undefined>;
  path: string;
  values: Map<string, string>;
  workspaceConflicts: string[];
};
