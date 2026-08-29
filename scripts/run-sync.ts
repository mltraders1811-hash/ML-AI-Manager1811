// CLI entrypoint for the daily sync pipeline, run by GitHub Actions:
//   npm run sync
// Deliberately outside src/app so Next.js never bundles better-sqlite3,
// adm-zip, or googleapis into a Vercel serverless function.
import { prisma } from "../src/lib/prisma";
import { runSync } from "../src/lib/sync/syncEngine";

/**
 * runSync records its own failures, but only once it has got far enough to
 * create the SyncRun row - a bad config or an unreachable Drive folder
 * throws before that, leaving no trace for the dashboard to show. Writing a
 * row here means the app can say "the sync tried and failed" rather than
 * quietly serving yesterday's numbers as if they were today's.
 */
async function recordEarlyFailure(message: string) {
  const companyId = process.env.DEFAULT_COMPANY_ID;
  if (!companyId) return;
  try {
    const alreadyRecorded = await prisma.syncRun.findFirst({
      where: { companyId, finishedAt: null },
      orderBy: { startedAt: "desc" },
    });
    if (alreadyRecorded) {
      await prisma.syncRun.update({
        where: { id: alreadyRecorded.id },
        data: { finishedAt: new Date(), status: "FAILED", errorMessage: message },
      });
      return;
    }
    await prisma.syncRun.create({
      data: { companyId, finishedAt: new Date(), status: "FAILED", errorMessage: message },
    });
  } catch {
    // The database itself may be what's broken. Nothing more we can do here -
    // the job still exits non-zero, which is what alerts on the CI side.
  }
}

async function main() {
  console.log(`[sync] starting at ${new Date().toISOString()}`);
  const result = await runSync();
  console.log(`[sync] done: ${JSON.stringify(result, null, 2)}`);
  if (result.warnings.length) {
    console.warn(`[sync] ${result.warnings.length} warning(s) - see SyncRun.errorMessage in the DB for the full list`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync] FAILED:", message);
    await recordEarlyFailure(message);
    await prisma.$disconnect();
    process.exit(1);
  });
