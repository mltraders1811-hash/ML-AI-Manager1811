import { prisma } from "@/lib/prisma";

/** The daily job runs at 08:30 IST. Allowing a day and a half means a
 * single missed run is tolerated (a late backup, a slow Drive upload), but
 * two in a row is surfaced - by then the numbers are genuinely stale. */
const STALE_AFTER_HOURS = 36;

export type SyncHealth = {
  status: "ok" | "failed" | "stale" | "never";
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  hoursSinceSuccess: number | null;
  sourceFileName: string | null;
  errorMessage: string | null;
  /** Plain-language line to show the owner. Null when everything is fine. */
  warning: string | null;
};

function hoursAgo(d: Date): number {
  return (Date.now() - d.getTime()) / 3_600_000;
}

export async function getSyncHealth(companyId: string): Promise<SyncHealth> {
  const [lastRun, lastSuccess] = await Promise.all([
    prisma.syncRun.findFirst({ where: { companyId }, orderBy: { startedAt: "desc" } }),
    prisma.syncRun.findFirst({
      where: { companyId, status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  if (!lastRun) {
    return {
      status: "never",
      lastRunAt: null,
      lastSuccessAt: null,
      hoursSinceSuccess: null,
      sourceFileName: null,
      errorMessage: null,
      warning: "No sync has run yet, so these numbers are empty. Use Sync Now to fetch your first backup.",
    };
  }

  const hoursSinceSuccess = lastSuccess ? hoursAgo(lastSuccess.startedAt) : null;

  // A failure is worth flagging even if an older run succeeded: the figures
  // on screen are from that older run, not from today's books.
  if (lastRun.status === "FAILED") {
    return {
      status: "failed",
      lastRunAt: lastRun.startedAt,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      hoursSinceSuccess,
      sourceFileName: lastSuccess?.sourceFileName ?? null,
      errorMessage: lastRun.errorMessage,
      warning: lastSuccess
        ? `The last sync failed. These figures are from ${describeAge(hoursSinceSuccess!)} ago and may be out of date.`
        : "The last sync failed and no sync has ever succeeded, so there is no data to show.",
    };
  }

  if (hoursSinceSuccess !== null && hoursSinceSuccess > STALE_AFTER_HOURS) {
    return {
      status: "stale",
      lastRunAt: lastRun.startedAt,
      lastSuccessAt: lastSuccess!.startedAt,
      hoursSinceSuccess,
      sourceFileName: lastSuccess!.sourceFileName,
      errorMessage: null,
      warning: `No successful sync in ${describeAge(hoursSinceSuccess)}. Check that Vyapar is still backing up to Google Drive.`,
    };
  }

  return {
    status: "ok",
    lastRunAt: lastRun.startedAt,
    lastSuccessAt: lastSuccess?.startedAt ?? null,
    hoursSinceSuccess,
    sourceFileName: lastSuccess?.sourceFileName ?? null,
    errorMessage: null,
    warning: null,
  };
}

/** A bare duration ("3 days", "5 hours") - callers add "ago" where the
 * sentence needs it. */
function describeAge(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${Math.floor(hours)} hours`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
