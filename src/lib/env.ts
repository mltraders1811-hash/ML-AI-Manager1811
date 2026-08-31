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
  // Push notifications are opt-in config: absent keys disable the feature
  // rather than blocking boot, because the app is fully usable without it.
  VAPID_PUBLIC_KEY: optionalEnv(z.string().optional()),
  VAPID_PRIVATE_KEY: optionalEnv(z.string().optional()),
  VAPID_SUBJECT: optionalEnv(z.string().optional()),
  // Bearer token for /api/bank/ingest, where forwarded bank SMS and emails
  // arrive. Absent disables that endpoint entirely rather than leaving an
  // unauthenticated way into the books.
  BANK_INGEST_TOKEN: optionalEnv(z.string().min(16, "BANK_INGEST_TOKEN must be at least 16 characters").optional()),
  // Comma-separated last-4s of the accounts whose alerts to book, e.g.
  // "1811,9920". A phone gets alerts for every account registered to its
  // number; blank books whatever arrives.
  BANK_ALERT_ACCOUNTS: optionalEnv(z.string().optional()),
  // Comma-separated bank names whose alerts to book, e.g. "ICICI". A
  // message that doesn't identify its bank is refused while this is set;
  // blank books whatever arrives.
  BANK_ALERT_BANKS: optionalEnv(z.string().optional()),
});

const syncEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DEFAULT_COMPANY_ID: z.string().uuid("DEFAULT_COMPANY_ID must be a UUID"),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1, "GOOGLE_SERVICE_ACCOUNT_JSON is required"),
  GDRIVE_BACKUP_FOLDER_ID: z.string().min(1, "GDRIVE_BACKUP_FOLDER_ID is required"),
  // Optional second folder: where bank statements land. Absent means the
  // bank screen still works from uploads, just without the daily pickup.
  GDRIVE_BANK_STATEMENT_FOLDER_ID: optionalEnv(z.string().optional()),
  DEFAULT_PAYMENT_TERMS_DAYS: optionalEnv(z.coerce.number().int().positive().default(15)),
  VAPID_PUBLIC_KEY: optionalEnv(z.string().optional()),
  VAPID_PRIVATE_KEY: optionalEnv(z.string().optional()),
  VAPID_SUBJECT: optionalEnv(z.string().optional()),
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
