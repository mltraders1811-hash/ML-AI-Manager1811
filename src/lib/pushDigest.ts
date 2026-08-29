import { formatInr } from "@/lib/format";
import type { OverdueResult } from "@/lib/overdue";

export type PushMessage = {
  title: string;
  body: string;
  /** Where a tap should land. */
  url: string;
  /** Notifications sharing a tag replace each other on the lock screen. */
  tag: string;
};

/** A notification has to earn the interruption. Below this the daily digest
 * stays silent rather than buzzing a phone about a few hundred rupees. */
export const DIGEST_MIN_OVERDUE = 1000;

/** How many parties to name before falling back to a count. Three fits a
 * lock-screen preview; more gets truncated by the OS anyway. */
const NAMED_PARTIES = 3;

/**
 * The once-a-day summary of what's owed past its credit period.
 *
 * Returns null when there's nothing worth waking someone for - an empty or
 * trivial book. That "no news, no notification" rule is what keeps the
 * alert meaningful when it does arrive.
 */
export function buildOverdueDigest(overdue: OverdueResult): PushMessage | null {
  const { totalOverdue, customerCount } = overdue.summary;
  if (customerCount === 0 || totalOverdue < DIGEST_MIN_OVERDUE) return null;

  // The list is already ordered by the screen's own ranking; sort a copy by
  // amount so the notification names the parties that matter most by money.
  const byAmount = [...overdue.customers]
    .filter((c) => c.overdueAmount > 0)
    .sort((a, b) => b.overdueAmount - a.overdueAmount);

  const named = byAmount
    .slice(0, NAMED_PARTIES)
    .map((c) => `${c.party} ₹${formatInr(Math.round(c.overdueAmount))}`)
    .join(" · ");
  const rest = byAmount.length - Math.min(NAMED_PARTIES, byAmount.length);

  const oldest = overdue.customers.reduce((max, c) => Math.max(max, c.maxDaysOverdue), 0);

  const lines = [
    `${customerCount} party ${overdue.creditDays} din se upar. Sabse purana ${oldest} din.`,
    rest > 0 ? `${named} +${rest} aur` : named,
  ];

  return {
    title: `₹${formatInr(Math.round(totalOverdue))} vasooli baaki`,
    body: lines.join("\n"),
    url: "/overdue",
    tag: "overdue-digest",
  };
}

/**
 * Sent when the nightly sync fails. Worth its own notification because the
 * dashboard's banner only warns someone who happens to open the app, and
 * the figures silently stop moving until it's fixed.
 */
export function buildSyncFailureAlert(reason: string): PushMessage {
  const short = reason.length > 120 ? `${reason.slice(0, 117)}...` : reason;
  return {
    title: "Aaj ka sync fail hua",
    body: `Vyapar ka data update nahi hua - app purane numbers dikha raha hai.\n${short}`,
    url: "/",
    tag: "sync-failure",
  };
}
