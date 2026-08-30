// Reading and deciding: what the bank screen shows, and what happens when
// someone taps a customer against a payment.
//
// Suggestions are recomputed on read rather than stored. A rule learnt this
// morning should improve every unassigned line from last month too, and it
// only does that if the guess is made fresh each time the list is opened.
import type { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/apiError";
import { istStartOfDay } from "@/lib/dateIst";
import { prisma } from "@/lib/prisma";

import { getAlertActivity } from "./alertService";
import { loadMatchContext } from "./importService";
import { matchTransaction, type MatchSuggestion } from "./matcher";

/** Confidence written when a person taps the customer themselves. */
const MANUAL_CONFIDENCE = 100;
/** Confidence written when their decision is replayed onto a similar line. */
const APPLIED_RULE_CONFIDENCE = 96;

export type BankTxnView = {
  id: string;
  date: string;
  valueDate: string | null;
  description: string;
  counterparty: string | null;
  reference: string | null;
  direction: "CREDIT" | "DEBIT";
  amount: number;
  balanceAfter: number | null;
  status: "UNMATCHED" | "SUGGESTED" | "MATCHED" | "IGNORED";
  customer: { id: string; name: string; balance: number } | null;
  matchedBy: "AUTO_RULE" | "AUTO_NAME" | "MANUAL" | null;
  matchConfidence: number | null;
  note: string | null;
  ignoreReason: string | null;
  accountLabel: string;
  /** Only ever populated for lines still waiting on a decision. */
  suggestions: MatchSuggestion[];
  /** Other undecided lines from the same payer, which one tap can clear too. */
  similarPending: number;
};

export type BankView = "review" | "assigned" | "ignored" | "out" | "all";

const VIEW_FILTERS: Record<BankView, object> = {
  review: { direction: "CREDIT", status: { in: ["UNMATCHED", "SUGGESTED"] } },
  assigned: { status: "MATCHED" },
  ignored: { status: "IGNORED" },
  out: { direction: "DEBIT" },
  all: {},
};

type TxnRow = Prisma.BankTransactionGetPayload<{
  include: { account: { select: { label: true } }; customer: { select: { id: true; name: true; currentBalance: true } } };
}>;

const TXN_INCLUDE = {
  account: { select: { label: true } },
  customer: { select: { id: true, name: true, currentBalance: true } },
} as const;

/**
 * Turns stored rows into what the screen shows, guessing afresh for any
 * line still awaiting a decision. Batched: one match context and one
 * grouped count for the whole page, not a query per row.
 */
async function toViews(companyId: string, rows: TxnRow[]): Promise<BankTxnView[]> {
  const undecided = rows.filter((r) => r.status === "UNMATCHED" || r.status === "SUGGESTED");
  const context = undecided.length ? await loadMatchContext(companyId) : { customers: [], rules: [] };

  const keys = [...new Set(undecided.map((r) => r.counterpartyKey).filter((k): k is string => Boolean(k)))];
  const pendingByKey = new Map<string, number>();
  if (keys.length) {
    const grouped = await prisma.bankTransaction.groupBy({
      by: ["counterpartyKey"],
      where: { companyId, counterpartyKey: { in: keys }, direction: "CREDIT", status: { in: ["UNMATCHED", "SUGGESTED"] } },
      _count: { _all: true },
    });
    for (const g of grouped) {
      if (g.counterpartyKey) pendingByKey.set(g.counterpartyKey, g._count._all);
    }
  }

  return rows.map((row) => {
    const needsDecision = row.status === "UNMATCHED" || row.status === "SUGGESTED";
    const suggestions = needsDecision
      ? matchTransaction(
          {
            description: row.description,
            reference: row.reference,
            amount: row.amount.toNumber(),
            direction: row.direction,
          },
          context,
        ).suggestions
      : [];

    return {
      id: row.id,
      date: row.txnDate.toISOString(),
      valueDate: row.valueDate?.toISOString() ?? null,
      description: row.description,
      counterparty: row.counterparty,
      reference: row.reference,
      direction: row.direction,
      amount: row.amount.toNumber(),
      balanceAfter: row.balanceAfter?.toNumber() ?? null,
      status: row.status,
      customer: row.customer
        ? { id: row.customer.id, name: row.customer.name, balance: row.customer.currentBalance.toNumber() }
        : null,
      matchedBy: row.matchedBy,
      matchConfidence: row.matchConfidence,
      note: row.note,
      ignoreReason: row.ignoreReason,
      accountLabel: row.account.label,
      suggestions,
      similarPending:
        needsDecision && row.counterpartyKey ? Math.max(0, (pendingByKey.get(row.counterpartyKey) ?? 1) - 1) : 0,
    };
  });
}

export async function listTransactions(
  companyId: string,
  opts: { view?: BankView; query?: string; customerId?: string; limit?: number } = {},
): Promise<{ transactions: BankTxnView[]; total: number }> {
  const view = opts.view ?? "review";
  const query = (opts.query ?? "").trim();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);

  const where = {
    companyId,
    ...VIEW_FILTERS[view],
    ...(opts.customerId ? { customerId: opts.customerId } : {}),
    ...(query
      ? {
          OR: [
            { description: { contains: query, mode: "insensitive" as const } },
            { counterparty: { contains: query, mode: "insensitive" as const } },
            { customer: { name: { contains: query, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: TXN_INCLUDE,
    }),
    prisma.bankTransaction.count({ where }),
  ]);

  return { transactions: await toViews(companyId, rows), total };
}

/** One row in the same shape the list returns, for an API response. */
async function singleView(companyId: string, id: string): Promise<BankTxnView> {
  const row = await prisma.bankTransaction.findFirst({ where: { id, companyId }, include: TXN_INCLUDE });
  if (!row) throw new ApiError(404, "That bank entry no longer exists");
  return (await toViews(companyId, [row]))[0]!;
}

export type BankSummary = {
  needsReview: { count: number; amount: number };
  thisMonth: { received: number; paidOut: number; assigned: number; unassigned: number };
  autoMatchedThisMonth: number;
  lastImport: { at: string; filename: string; source: "UPLOAD" | "DRIVE" | "API"; rowsImported: number } | null;
  accounts: { id: string; label: string; lastTxnDate: string | null; balance: number | null }[];
  /** Forwarded bank SMS/email over the last week - is that pipeline alive? */
  alerts: { booked: number; duplicate: number; ignored: number; lastAt: string | null };
  hasData: boolean;
};

/** Start of the current month, IST - the same calendar the shop uses. */
function monthStart(): Date {
  const today = istStartOfDay(new Date());
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
}

export async function getBankSummary(companyId: string): Promise<BankSummary> {
  const from = monthStart();

  const [pending, monthCredits, monthDebits, monthAssigned, autoMatched, lastImport, accounts, anyTxn, alerts] =
    await Promise.all([
      prisma.bankTransaction.aggregate({
        where: { companyId, direction: "CREDIT", status: { in: ["UNMATCHED", "SUGGESTED"] } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.bankTransaction.aggregate({
        where: { companyId, direction: "CREDIT", txnDate: { gte: from }, status: { not: "IGNORED" } },
        _sum: { amount: true },
      }),
      prisma.bankTransaction.aggregate({
        where: { companyId, direction: "DEBIT", txnDate: { gte: from }, status: { not: "IGNORED" } },
        _sum: { amount: true },
      }),
      prisma.bankTransaction.aggregate({
        where: { companyId, direction: "CREDIT", txnDate: { gte: from }, status: "MATCHED" },
        _sum: { amount: true },
      }),
      prisma.bankTransaction.count({
        where: {
          companyId,
          direction: "CREDIT",
          txnDate: { gte: from },
          matchedBy: { in: ["AUTO_RULE", "AUTO_NAME"] },
        },
      }),
      prisma.bankStatementImport.findFirst({
        where: { companyId },
        orderBy: { importedAt: "desc" },
        select: { importedAt: true, filename: true, source: true, rowsImported: true },
      }),
      prisma.bankAccount.findMany({
        where: { companyId },
        select: { id: true, label: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.bankTransaction.findFirst({ where: { companyId }, select: { id: true } }),
      getAlertActivity(companyId),
    ]);

  const accountViews = await Promise.all(
    accounts.map(async (a) => {
      const latest = await prisma.bankTransaction.findFirst({
        where: { companyId, accountId: a.id },
        orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
        select: { txnDate: true, balanceAfter: true },
      });
      return {
        id: a.id,
        label: a.label,
        lastTxnDate: latest?.txnDate.toISOString() ?? null,
        balance: latest?.balanceAfter?.toNumber() ?? null,
      };
    }),
  );

  const received = monthCredits._sum.amount?.toNumber() ?? 0;
  const assigned = monthAssigned._sum.amount?.toNumber() ?? 0;

  return {
    needsReview: { count: pending._count._all, amount: pending._sum.amount?.toNumber() ?? 0 },
    thisMonth: {
      received,
      paidOut: monthDebits._sum.amount?.toNumber() ?? 0,
      assigned,
      unassigned: Math.max(0, received - assigned),
    },
    autoMatchedThisMonth: autoMatched,
    lastImport: lastImport
      ? {
          at: lastImport.importedAt.toISOString(),
          filename: lastImport.filename,
          source: lastImport.source,
          rowsImported: lastImport.rowsImported,
        }
      : null,
    accounts: accountViews,
    alerts,
    hasData: anyTxn !== null,
  };
}

async function getTransaction(companyId: string, id: string) {
  const txn = await prisma.bankTransaction.findFirst({ where: { id, companyId } });
  if (!txn) throw new ApiError(404, "That bank entry no longer exists");
  return txn;
}

/**
 * Records whose payment this is - the one decision the whole screen exists
 * for. The decision is also remembered as a rule, so the same payer is
 * recognised without asking next month, and can be replayed immediately
 * onto the other undecided lines from that payer.
 */
export async function assignTransaction(
  companyId: string,
  id: string,
  customerId: string,
  opts: { applySimilar?: boolean; note?: string | null } = {},
): Promise<{ transaction: BankTxnView; alsoApplied: number }> {
  const txn = await getTransaction(companyId, id);

  const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true } });
  if (!customer) throw new ApiError(404, "That customer no longer exists");

  await prisma.bankTransaction.update({
    where: { id: txn.id },
    data: {
      customerId,
      status: "MATCHED",
      matchedBy: "MANUAL",
      matchConfidence: MANUAL_CONFIDENCE,
      reconciledAt: new Date(),
      ignoreReason: null,
      ...(opts.note !== undefined ? { note: opts.note } : {}),
    },
  });

  if (txn.counterpartyKey) {
    // hits is what tells the matcher how settled a habit this is, and what
    // the screen shows as "assigned to them 4 times before".
    await prisma.bankMatchRule.upsert({
      where: { companyId_counterpartyKey: { companyId, counterpartyKey: txn.counterpartyKey } },
      update: { customerId, hits: { increment: 1 }, lastUsedAt: new Date() },
      create: { companyId, counterpartyKey: txn.counterpartyKey, customerId, hits: 1 },
    });
  }

  let alsoApplied = 0;
  if (opts.applySimilar && txn.counterpartyKey) {
    const result = await prisma.bankTransaction.updateMany({
      where: {
        companyId,
        counterpartyKey: txn.counterpartyKey,
        direction: "CREDIT",
        status: { in: ["UNMATCHED", "SUGGESTED"] },
        id: { not: txn.id },
      },
      data: {
        customerId,
        status: "MATCHED",
        matchedBy: "AUTO_RULE",
        matchConfidence: APPLIED_RULE_CONFIDENCE,
        reconciledAt: new Date(),
      },
    });
    alsoApplied = result.count;
  }

  return { transaction: await singleView(companyId, txn.id), alsoApplied };
}

/** Not a customer payment: a supplier refund, a self transfer, bank charges. */
export async function ignoreTransaction(companyId: string, id: string, reason: string | null): Promise<BankTxnView> {
  const txn = await getTransaction(companyId, id);
  await prisma.bankTransaction.update({
    where: { id: txn.id },
    data: {
      status: "IGNORED",
      customerId: null,
      matchedBy: null,
      matchConfidence: null,
      reconciledAt: new Date(),
      ignoreReason: reason?.trim() || null,
    },
  });
  return singleView(companyId, txn.id);
}

/**
 * Puts a line back in the review queue. Any rule that produced the wrong
 * answer goes with it - otherwise the same mistake is repeated, silently,
 * on every future statement.
 */
export async function unassignTransaction(companyId: string, id: string): Promise<BankTxnView> {
  const txn = await getTransaction(companyId, id);

  if (txn.counterpartyKey && txn.customerId) {
    await prisma.bankMatchRule.deleteMany({
      where: { companyId, counterpartyKey: txn.counterpartyKey, customerId: txn.customerId },
    });
  }

  await prisma.bankTransaction.update({
    where: { id: txn.id },
    data: {
      status: "UNMATCHED",
      customerId: null,
      matchedBy: null,
      matchConfidence: null,
      reconciledAt: null,
      ignoreReason: null,
    },
  });
  return singleView(companyId, txn.id);
}

export async function setNote(companyId: string, id: string, note: string | null): Promise<BankTxnView> {
  const txn = await getTransaction(companyId, id);
  await prisma.bankTransaction.update({ where: { id: txn.id }, data: { note: note?.trim() || null } });
  return singleView(companyId, txn.id);
}

/** What each customer has actually paid into the bank over a period - the
 * answer to "did that party's money ever arrive?". */
export async function getReceiptsByCustomer(
  companyId: string,
  opts: { from?: Date } = {},
): Promise<{ customerId: string; name: string; received: number; count: number; lastPaidAt: string }[]> {
  const grouped = await prisma.bankTransaction.groupBy({
    by: ["customerId"],
    where: {
      companyId,
      direction: "CREDIT",
      status: "MATCHED",
      customerId: { not: null },
      ...(opts.from ? { txnDate: { gte: opts.from } } : {}),
    },
    _sum: { amount: true },
    _count: { _all: true },
    _max: { txnDate: true },
  });

  const ids = grouped.map((g) => g.customerId).filter((id): id is string => Boolean(id));
  if (!ids.length) return [];

  const customers = await prisma.customer.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, name: true },
  });
  const nameById = new Map(customers.map((c) => [c.id, c.name]));

  return grouped
    .map((g) => ({
      customerId: g.customerId!,
      name: nameById.get(g.customerId!) ?? "Unknown",
      received: g._sum.amount?.toNumber() ?? 0,
      count: g._count._all,
      lastPaidAt: (g._max.txnDate ?? new Date(0)).toISOString(),
    }))
    .sort((a, b) => b.received - a.received);
}
