import "server-only";

import { z } from "zod";

const postgresUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value.startsWith("postgres://") || value.startsWith("postgresql://"),
    "DATABASE_URL must be a PostgreSQL connection URL",
  );

const sensoPolicyBindingSchema = z
  .object({
    contentId: z.string().min(1),
    recordDigest: z.string().regex(/^[a-f0-9]{64}$/),
    versionId: z.string().min(1),
  })
  .strict();

const sensoPolicyBindingsSchema = z
  .string()
  .default("[]")
  .transform((value, context) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({
        code: "custom",
        message: "SENSO_POLICY_BINDINGS must be valid JSON",
      });
      return z.NEVER;
    }
  })
  .pipe(z.array(sensoPolicyBindingSchema));

const liveEnvironmentSchema = z.object({
  APP_BASE_URL: z.url(),
  APPROVAL_TOKEN_PEPPER: z.string().min(32),
  DATABASE_SSL: z.enum(["disable", "prefer", "require"]).default("require"),
  DATABASE_URL: postgresUrlSchema,
  LIVE_REQUEST_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(15)
    .max(1_440)
    .default(180),
  OPENAI_API_KEY: z.string().min(20),
  OPENAI_FALLBACK_MODEL: z.string().min(1).default("gpt-5.6-sol"),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6-luna"),
  PRAVA_MERCHANT_COUNTRY: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default("US"),
  PRAVA_MERCHANT_SECRET_KEY: z.string().startsWith("sk_test_"),
  PRAVA_USER_EMAIL: z.email().default("sandbox-user@relaybuy.app"),
  PRAVA_USER_ID: z.string().min(1).max(255).default("relaybuy-sandbox-user"),
  SENSO_API_KEY: z.string().min(10),
  SENSO_BASE_URL: z.url().default("https://apiv2.senso.ai/api/v1"),
  SENSO_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.35),
  SENSO_POLICY_BINDINGS: sensoPolicyBindingsSchema,
});

export type LiveEnvironment = z.infer<typeof liveEnvironmentSchema>;

let cachedEnvironment: LiveEnvironment | undefined;

export function getLiveEnvironment(): LiveEnvironment {
  cachedEnvironment ??= liveEnvironmentSchema.parse({
    ...process.env,
    APP_BASE_URL:
      process.env.APP_BASE_URL?.trim() ||
      process.env.RENDER_EXTERNAL_URL?.trim(),
  });
  return cachedEnvironment;
}
