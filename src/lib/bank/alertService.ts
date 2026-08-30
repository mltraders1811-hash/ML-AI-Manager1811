// Books a forwarded bank alert (an SMS or an email from the bank) as a
// transaction.
//
// The path is: the phone receives the bank's SMS -> a forwarding app posts
// it to /api/bank/ingest -> here. What arrives is one line of the statement,
// hours or days before the statement itself, so it is treated as
// provisional: the same payment appearing in a later statement supersedes
// it (see supersedeAlerts in importService.ts), carrying over whoever it was
// assigned to in the meantime.
//
// Every message is logged whatever happens to it. A forwarded SMS that
// silently goes nowhere is worse than no forwarding at all - the owner has
// no way to tell the app is even receiving them.
import { createHash } from "crypto";

import { prisma } from "@/lib/prisma";

import { parseBankAlert } from "./alertParser";
import { loadMatchContext, resolveAccount } from "./importService";
import { matchTransaction } from "./matcher";

/** Payments this close together, for the same amount, are the same payment. */
const DUPLICATE_WINDOW_DAYS = 1;
const MAX_BODY_CHARS = 2000;

export type AlertIngestResult =
  | {
      status: "booked";
      transactionId: string;
      amount: number;
      direction: "CREDIT" | "DEBIT";
      accountLabel: string;
      /** Set when the payment was recognised outright and needs nobody. */
      matchedCustomer: string | null;
      counterparty: string | null;
    }
  | { status: "duplicate"; reason: string }
  | { status: "ignored"; reason: string };

export type AlertIngestRequest = {
  companyId: string;
  text: string;
  sender?: string | null;
  receivedAt?: Date;
  /**
   * Last-4s of the accounts to book. A phone gets alerts for every account
   * its number is registered against - the shop's current account, a
   * personal savings account, a credit card - and only the named ones are
   * this business's money. Empty means book whatever arrives.
   */
  accountsLast4?: string[];
};

async function log(
  companyId: string,
  req: AlertIngestRequest,
  status: "BOOKED" | "DUPLICATE" | "IGNORED",
  reason: string | null,
  transactionId: string | null,
) {
  await prisma.bankAlertLog.create({
    data: {
      companyId,
      receivedAt: req.receivedAt ?? new Date(),
      sender: req.sender ?? null,
      body: req.text.slice(0, MAX_BODY_CHARS),
      status,
      reason,
      transactionId,
    },
  });
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function ingestAlert(req: AlertIngestRequest): Promise<AlertIngestResult> {
  const { companyId } = req;
  const parsed = parseBankAlert(req.text, { sender: req.sender, receivedAt: req.receivedAt });

  if (!parsed.ok) {
    await log(companyId, req, "IGNORED", parsed.reason, null);
    return { status: "ignored", reason: parsed.reason };
  }
  const alert = parsed.alert;

  const wanted = (req.accountsLast4 ?? []).filter(Boolean);
  if (wanted.length) {
    if (!alert.accountLast4) {
      const reason = "Message doesn't say which account it is about";
      await log(companyId, req, "IGNORED", reason, null);
      return { status: "ignored", reason };
    }
    if (!wanted.includes(alert.accountLast4)) {
      const reason = `For account ••${alert.accountLast4}, which isn't one of the tracked accounts`;
      await log(companyId, req, "IGNORED", reason, null);
      return { status: "ignored", reason };
    }
  }

  const account = await resolveAccount(companyId, {
    bankName: alert.bankName,
    accountLast4: alert.accountLast4,
  });

  // Two separate ways the same payment can already be known: the identical
  // message arriving twice (a forwarder retry), and the payment itself
  // already being on file from a statement or an earlier alert.
  const fingerprint = createHash("sha256")
    .update(`${account.id}|ALERT|${alert.description.toUpperCase()}`)
    .digest("hex")
    .slice(0, 32);

  const sameMessage = await prisma.bankTransaction.findUnique({
    where: { companyId_fingerprint: { companyId, fingerprint } },
    select: { id: true },
  });
  if (sameMessage) {
    await log(companyId, req, "DUPLICATE", "This exact message was already received", sameMessage.id);
    return { status: "duplicate", reason: "This exact message was already received" };
  }

  const samePayment = await prisma.bankTransaction.findFirst({
    where: {
      companyId,
      accountId: account.id,
      direction: alert.direction,
      amount: alert.amount,
      txnDate: { gte: addDays(alert.date, -DUPLICATE_WINDOW_DAYS), lte: addDays(alert.date, DUPLICATE_WINDOW_DAYS) },
      ...(alert.reference ? { OR: [{ reference: alert.reference }, { reference: null }] } : {}),
    },
    select: { id: true, origin: true },
  });
  if (samePayment) {
    const reason =
      samePayment.origin === "STATEMENT"
        ? "This payment is already in from the statement"
        : "This payment was already received in an earlier alert";
    await log(companyId, req, "DUPLICATE", reason, samePayment.id);
    return { status: "duplicate", reason };
  }

  const context = await loadMatchContext(companyId);
  const outcome = matchTransaction(
    {
      description: alert.counterparty ?? alert.description,
      reference: alert.reference,
      amount: alert.amount,
      direction: alert.direction,
    },
    { customers: context.customers, rules: context.rules },
  );
  const auto = alert.direction === "CREDIT" ? outcome.auto : null;

  const created = await prisma.bankTransaction.create({
    data: {
      companyId,
      accountId: account.id,
      origin: "ALERT",
      txnDate: alert.date,
      description: alert.description,
      reference: alert.reference,
      direction: alert.direction,
      amount: alert.amount,
      balanceAfter: alert.balanceAfter,
      fingerprint,
      // The counterparty the alert reader found is better than anything
      // re-derived from the message as a whole, but the key has to come from
      // the matcher so it lines up with the rules learnt from statements.
      counterparty: alert.counterparty ?? outcome.counterparty,
      counterpartyKey: alert.counterpartyKey ?? outcome.counterpartyKey,
      status: auto ? "MATCHED" : outcome.suggestions.length ? "SUGGESTED" : "UNMATCHED",
      customerId: auto?.customerId ?? null,
      matchedBy: auto?.source ?? null,
      matchConfidence: auto?.confidence ?? null,
      reconciledAt: auto ? new Date() : null,
    },
    select: { id: true },
  });

  await log(companyId, req, "BOOKED", null, created.id);

  const matchedName = auto ? (context.customers.find((c) => c.id === auto.customerId)?.name ?? null) : null;
  return {
    status: "booked",
    transactionId: created.id,
    amount: alert.amount,
    direction: alert.direction,
    accountLabel: account.label,
    matchedCustomer: matchedName,
    counterparty: alert.counterparty,
  };
}

/** How the SMS pipeline has been doing lately, for the Bank screen. */
export async function getAlertActivity(
  companyId: string,
  days = 7,
): Promise<{ booked: number; duplicate: number; ignored: number; lastAt: string | null }> {
  const since = addDays(new Date(), -days);
  const [grouped, last] = await Promise.all([
    prisma.bankAlertLog.groupBy({
      by: ["status"],
      where: { companyId, receivedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.bankAlertLog.findFirst({
      where: { companyId },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
  ]);

  const count = (status: string) => grouped.find((g) => g.status === status)?._count._all ?? 0;
  return {
    booked: count("BOOKED"),
    duplicate: count("DUPLICATE"),
    ignored: count("IGNORED"),
    lastAt: last?.receivedAt.toISOString() ?? null,
  };
}
