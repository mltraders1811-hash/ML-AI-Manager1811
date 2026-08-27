import { z } from "zod";

// An env var that is declared but not set (e.g. GitHub Actions expanding an
// unset `vars.X` into the empty string) must be treated as absent, not as a
// value - otherwise `.default()` never applies and coercion turns "" into 0.
const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

// Fail fast and clearly at boot if config is missing, instead of an opaque
// crash three layers deep the first time a route touches the DB or Drive.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DEFAULT_COMPANY_ID: z.string().uuid("DEFAULT_COMPANY_ID must be a UUID"),
  ADMIN_USERNAME: z.string().min(1, "ADMIN_USERNAME is required"),
  ADMIN_PASSWORD_HASH: z.string().min(1, "ADMIN_PASSWORD_HASH is required"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  ANTHROPIC_API_KEY: optionalEnv(z.string().optional()),
  DEFAULT_PAYMENT_TERMS_DAYS: optionalEnv(z.coerce.number().int().positive().default(15)),
});

const syncEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DEFAULT_COMPANY_ID: z.string().uuid("DEFAULT_COMPANY_ID must be a UUID"),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1, "GOOGLE_SERVICE_ACCOUNT_JSON is required"),
  GDRIVE_BACKUP_FOLDER_ID: z.string().min(1, "GDRIVE_BACKUP_FOLDER_ID is required"),
  DEFAULT_PAYMENT_TERMS_DAYS: optionalEnv(z.coerce.number().int().positive().default(15)),
});

let cached: z.infer<typeof envSchema> | null = null;

/** Env needed by the Next.js app (dashboard/API). */
export function getEnv() {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

let cachedSyncEnv: z.infer<typeof syncEnvSchema> | null = null;

/** Env needed by the standalone sync script (GitHub Actions). */
export function getSyncEnv() {
  if (cachedSyncEnv) return cachedSyncEnv;
  const parsed = syncEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid sync environment configuration:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  cachedSyncEnv = parsed.data;
  return cachedSyncEnv;
}
