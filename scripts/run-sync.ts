// CLI entrypoint for the daily sync pipeline, run by GitHub Actions:
//   npm run sync
// Deliberately outside src/app so Next.js never bundles better-sqlite3,
// adm-zip, or googleapis into a Vercel serverless function.
import { runSync } from "../src/lib/sync/syncEngine";

async function main() {
  console.log(`[sync] starting at ${new Date().toISOString()}`);
  const result = await runSync();
  console.log(`[sync] done: ${JSON.stringify(result, null, 2)}`);
  if (result.warnings.length) {
    console.warn(`[sync] ${result.warnings.length} warning(s) - see SyncRun.errorMessage in the DB for the full list`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[sync] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
