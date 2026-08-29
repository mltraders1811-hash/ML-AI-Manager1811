import { afterAll, beforeEach, describe, expect, it } from "vitest";
import webpush from "web-push";

import { prisma } from "../src/lib/prisma";
import type { PushMessage } from "../src/lib/pushDigest";
import {
  deleteSubscription,
  isPushConfigured,
  istDayKey,
  saveSubscription,
  sendDailyDigest,
  type SendResult,
} from "../src/lib/push";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID!;

// Real keys, because web-push validates their shape - but they are generated
// per run and never used against a live push service: every test injects its
// own sender, so nothing leaves the process.
const KEYS = webpush.generateVAPIDKeys();

function withVapid<T>(fn: () => Promise<T>): Promise<T> {
  process.env.VAPID_PUBLIC_KEY = KEYS.publicKey;
  process.env.VAPID_PRIVATE_KEY = KEYS.privateKey;
  return fn().finally(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });
}

/** A sender that records what it was asked to deliver instead of delivering. */
function recorder() {
  const sent: PushMessage[] = [];
  const send = async (_companyId: string, message: PushMessage): Promise<SendResult> => {
    sent.push(message);
    return { sent: 1, removed: 0, failed: 0 };
  };
  return { sent, send };
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function addOverdueParty(name: string, amount: number, age: number) {
  const customer = await prisma.customer.create({
    data: { companyId: COMPANY_ID, externalId: `p-${name}`, name, currentBalance: amount, creditDays: 0 },
  });
  await prisma.invoice.create({
    data: {
      companyId: COMPANY_ID,
      externalId: `pi-${name}`,
      customerId: customer.id,
      type: "SALE",
      invoiceDate: daysAgo(age),
      dueDate: daysAgo(age),
      totalAmount: amount,
      paidAmount: 0,
      balanceAmount: amount,
    },
  });
}

async function addDevice(endpoint: string) {
  return saveSubscription(COMPANY_ID, { endpoint, keys: { p256dh: "p-key", auth: "a-key" } }, "Test device");
}

async function reset() {
  await prisma.pushDigest.deleteMany({ where: { companyId: COMPANY_ID } });
  await prisma.pushSubscription.deleteMany({ where: { companyId: COMPANY_ID } });
  await prisma.invoiceLineItem.deleteMany({ where: { companyId: COMPANY_ID } });
  await prisma.invoice.deleteMany({ where: { companyId: COMPANY_ID } });
  await prisma.customer.deleteMany({ where: { companyId: COMPANY_ID } });
}

describe("push subscriptions", () => {
  beforeEach(async () => {
    await prisma.company.upsert({
      where: { id: COMPANY_ID },
      update: {},
      create: { id: COMPANY_ID, name: "Test Co" },
    });
    await reset();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("treats a re-subscribe from the same browser as the same device", async () => {
    // Browsers hand back the same endpoint on re-subscribe. Inserting again
    // would mean two rows for one phone, and two buzzes per notification.
    await addDevice("https://push.example.com/abc");
    await addDevice("https://push.example.com/abc");
    expect(await prisma.pushSubscription.count({ where: { companyId: COMPANY_ID } })).toBe(1);
  });

  it("refreshes the keys when a browser rotates them", async () => {
    await addDevice("https://push.example.com/abc");
    await saveSubscription(COMPANY_ID, {
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: "new-p", auth: "new-a" },
    });
    const row = await prisma.pushSubscription.findUnique({ where: { endpoint: "https://push.example.com/abc" } });
    expect(row).toMatchObject({ p256dh: "new-p", auth: "new-a" });
  });

  it("removes only the device that unsubscribed", async () => {
    await addDevice("https://push.example.com/phone");
    await addDevice("https://push.example.com/laptop");
    await deleteSubscription("https://push.example.com/phone");
    const rows = await prisma.pushSubscription.findMany({ where: { companyId: COMPANY_ID } });
    expect(rows.map((r) => r.endpoint)).toEqual(["https://push.example.com/laptop"]);
  });

  it("reports push as unconfigured when the keys are absent", () => {
    expect(isPushConfigured()).toBe(false);
  });
});

describe("the daily digest", () => {
  beforeEach(async () => {
    await prisma.company.upsert({
      where: { id: COMPANY_ID },
      update: {},
      create: { id: COMPANY_ID, name: "Test Co" },
    });
    await reset();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("sends nothing when the server has no keys", async () => {
    await addDevice("https://push.example.com/abc");
    await addOverdueParty("Ramesh", 500000, 60);
    const { sent, send } = recorder();
    const outcome = await sendDailyDigest(COMPANY_ID, { send });
    expect(outcome).toEqual({ status: "skipped", reason: "not-configured" });
    expect(sent).toHaveLength(0);
  });

  it("sends nothing when no device has opted in", async () => {
    await addOverdueParty("Ramesh", 500000, 60);
    const outcome = await withVapid(() => sendDailyDigest(COMPANY_ID, { send: recorder().send }));
    expect(outcome).toMatchObject({ status: "skipped", reason: "no-devices" });
  });

  it("sends nothing when nothing is overdue", async () => {
    await addDevice("https://push.example.com/abc");
    const outcome = await withVapid(() => sendDailyDigest(COMPANY_ID, { send: recorder().send }));
    expect(outcome).toMatchObject({ status: "skipped", reason: "nothing-to-report" });
  });

  it("sends the digest when there is real money overdue", async () => {
    await addDevice("https://push.example.com/abc");
    await addOverdueParty("Ramesh", 500000, 60);
    const { sent, send } = recorder();
    const outcome = await withVapid(() => sendDailyDigest(COMPANY_ID, { send }));
    expect(outcome.status).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toContain("5,00,000");
  });

  it("does not buzz the phone twice when the sync runs twice in a day", async () => {
    // Pressing Sync Now after the morning job is a normal thing to do.
    await addDevice("https://push.example.com/abc");
    await addOverdueParty("Ramesh", 500000, 60);
    const { sent, send } = recorder();
    await withVapid(() => sendDailyDigest(COMPANY_ID, { send }));
    const second = await withVapid(() => sendDailyDigest(COMPANY_ID, { send }));
    expect(second).toMatchObject({ status: "skipped", reason: "already-sent-today" });
    expect(sent).toHaveLength(1);
  });

  it("sends again the next day", async () => {
    await addDevice("https://push.example.com/abc");
    await addOverdueParty("Ramesh", 500000, 60);
    const { sent, send } = recorder();
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    await withVapid(() => sendDailyDigest(COMPANY_ID, { now: yesterday, send }));
    const today = await withVapid(() => sendDailyDigest(COMPANY_ID, { send }));
    expect(today.status).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("records what was sent, so the digest can be audited later", async () => {
    await addDevice("https://push.example.com/abc");
    await addOverdueParty("Ramesh", 500000, 60);
    await withVapid(() => sendDailyDigest(COMPANY_ID, { send: recorder().send }));
    const rows = await prisma.pushDigest.findMany({ where: { companyId: COMPANY_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dayKey: istDayKey(), sentCount: 1 });
  });

  it("keys the day by IST, not UTC", async () => {
    // 22:00 UTC is already the next morning in India. Keying on UTC would
    // let a late-evening run send a second digest for "the same day".
    const lateEveningIst = new Date("2026-08-29T18:30:00.000Z"); // 30 Aug 00:00 IST
    expect(istDayKey(lateEveningIst)).toBe("2026-08-30");
    expect(istDayKey(new Date("2026-08-29T18:29:00.000Z"))).toBe("2026-08-29");
  });
});
