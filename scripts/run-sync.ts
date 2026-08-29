// CLI entrypoint for the daily sync pipeline, run by GitHub Actions:
//   npm run sync
// Deliberately outside src/app so Next.js never bundles better-sqlite3,
// adm-zip, or googleapis into a Vercel serverless function.
import { prisma } from "../src/lib/prisma";
import { sendDailyDigest, sendSyncFailureAlert } from "../src/lib/push";
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

/**
 * The digest is sent from here rather than from the app, because this is the
 * one moment the figures are known to be fresh. It is deliberately outside
 * the sync's own error handling: a push service being down must not turn a
 * successful sync into a failed one.
 */
async function notify() {
  const companyId = process.env.DEFAULT_COMPANY_ID;
  if (!companyId) return;
  try {
    const outcome = await sendDailyDigest(companyId);
    if (outcome.status === "sent") {
      console.log(`[push] digest sent to ${outcome.result.sent} device(s): ${outcome.title}`);
      if (outcome.result.removed) console.log(`[push] dropped ${outcome.result.removed} dead subscription(s)`);
    } else {
      console.log(`[push] no digest sent (${outcome.reason})`);
    }
  } catch (err) {
    console.warn(`[push] digest failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  console.log(`[sync] starting at ${new Date().toISOString()}`);
  const result = await runSync();
  console.log(`[sync] done: ${JSON.stringify(result, null, 2)}`);
  if (result.warnings.length) {
    console.warn(`[sync] ${result.warnings.length} warning(s) - see SyncRun.errorMessage in the DB for the full list`);
  }
  await notify();
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
    // The dashboard banner only warns whoever opens the app. A failed sync
    // that nobody notices means stale figures being read as current ones,
    // so it is worth a notification of its own.
    try {
      const companyId = process.env.DEFAULT_COMPANY_ID;
      if (companyId) await sendSyncFailureAlert(companyId, message);
    } catch {
      // Already failing; a second failure here changes nothing.
    }
    await prisma.$disconnect();
    process.exit(1);
  });
