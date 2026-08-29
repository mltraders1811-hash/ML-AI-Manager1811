import webpush from "web-push";

import { istDateString } from "@/lib/dateIst";
import { prisma } from "@/lib/prisma";
import { getOverdueCustomers } from "@/lib/overdue";
import { buildOverdueDigest, buildSyncFailureAlert, type PushMessage } from "@/lib/pushDigest";

// Web push needs a keypair the push services (FCM, Mozilla, Apple) can use
// to identify the sender. It's optional config: without it the app works
// exactly as before, minus the notification toggle. That matters because
// the keys have to be added in two places (Vercel and GitHub Actions) and a
// half-finished setup shouldn't break the dashboard.

export type SubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  // The subject is a contact address the push service can complain to; the
  // spec requires a mailto: or https: URL, so an unset one gets a stand-in
  // rather than an invalid header that fails every send.
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  return { publicKey, privateKey, subject };
}

export function isPushConfigured(): boolean {
  return vapid() !== null;
}

/** The browser needs this to create a subscription. It's public by design -
 * it only identifies the sender, it can't be used to send anything. */
export function getVapidPublicKey(): string | null {
  return vapid()?.publicKey ?? null;
}

export async function saveSubscription(companyId: string, sub: SubscriptionInput, label?: string) {
  // Re-subscribing on the same browser yields the same endpoint. Upserting
  // on it is what stops one phone collecting five rows and getting five
  // copies of every notification.
  return prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      companyId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      label: label?.slice(0, 80) ?? null,
    },
    update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, ...(label ? { label: label.slice(0, 80) } : {}) },
  });
}

export async function deleteSubscription(endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export type SendResult = { sent: number; removed: number; failed: number };

/**
 * Fans a message out to every device that has opted in.
 *
 * A push service answering 404 or 410 means that subscription is dead for
 * good (site data cleared, app uninstalled, browser reset). Deleting the
 * row on that answer is the only way the table doesn't fill up with
 * endpoints that will never work again. Any other error is treated as
 * temporary and left alone.
 */
export async function sendToAll(companyId: string, message: PushMessage): Promise<SendResult> {
  const config = vapid();
  if (!config) return { sent: 0, removed: 0, failed: 0 };
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const subs = await prisma.pushSubscription.findMany({ where: { companyId } });
  const payload = JSON.stringify(message);

  let sent = 0;
  let removed = 0;
  let failed = 0;
  const deadEndpoints: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 12 },
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          deadEndpoints.push(s.endpoint);
          removed += 1;
        } else {
          failed += 1;
          console.warn(`[push] send failed (${status ?? "no status"}) for ${s.endpoint.slice(0, 60)}...`);
        }
      }
    }),
  );

  if (deadEndpoints.length) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: deadEndpoints } } });
  }
  if (sent > 0) {
    await prisma.pushSubscription.updateMany({
      where: { companyId, endpoint: { notIn: deadEndpoints } },
      data: { lastSentAt: new Date() },
    });
  }

  return { sent, removed, failed };
}

/** IST calendar day as YYYY-MM-DD - the key the digest dedupes on. */
export function istDayKey(now = new Date()): string {
  return istDateString(now);
}

/** How the digest gets delivered. Injectable so the once-a-day guard can be
 * tested without a live push service. */
export type Sender = (companyId: string, message: PushMessage) => Promise<SendResult>;

export type DigestOutcome =
  | { status: "skipped"; reason: "not-configured" | "no-devices" | "nothing-to-report" | "already-sent-today" }
  | { status: "sent"; title: string; body: string; result: SendResult };

/**
 * The once-a-day overdue digest, sent at the end of a successful sync.
 *
 * Guarded by a per-day row so a second sync in the same day - a retry, or
 * the owner pressing Sync Now - doesn't buzz the phone again. The row is
 * written before sending: a crash mid-send costs one day's notification,
 * which is much better than a loop that sends it repeatedly.
 */
export async function sendDailyDigest(
  companyId: string,
  opts: { now?: Date; send?: Sender } = {},
): Promise<DigestOutcome> {
  const { now = new Date(), send = sendToAll } = opts;
  if (!isPushConfigured()) return { status: "skipped", reason: "not-configured" };

  const deviceCount = await prisma.pushSubscription.count({ where: { companyId } });
  if (deviceCount === 0) return { status: "skipped", reason: "no-devices" };

  const overdue = await getOverdueCustomers(companyId);
  const message = buildOverdueDigest(overdue);
  if (!message) return { status: "skipped", reason: "nothing-to-report" };

  const dayKey = istDayKey(now);
  try {
    await prisma.pushDigest.create({
      data: { companyId, dayKey, title: message.title, body: message.body, sentCount: deviceCount },
    });
  } catch {
    // The unique constraint on (companyId, dayKey) is the dedupe.
    return { status: "skipped", reason: "already-sent-today" };
  }

  const result = await send(companyId, message);
  return { status: "sent", title: message.title, body: message.body, result };
}

/** Alerts every device that the nightly sync failed. Not day-deduped: a
 * failure on consecutive days is worth hearing about each time, and the
 * shared tag means they replace rather than stack. */
export async function sendSyncFailureAlert(companyId: string, reason: string): Promise<SendResult> {
  if (!isPushConfigured()) return { sent: 0, removed: 0, failed: 0 };
  return sendToAll(companyId, buildSyncFailureAlert(reason));
}
