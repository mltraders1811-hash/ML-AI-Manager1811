// Turns a statement file into rows in the bank ledger.
//
// Importing the same period twice has to be harmless: statements overlap,
// the daily job re-reads whatever is in the Drive folder, and the owner
// will re-upload a file when unsure whether it went in. Every line
// therefore carries a fingerprint (see statementParser.ts) and lands
// through a skipDuplicates insert.
//
// Nothing here writes to Invoice or Customer.currentBalance: those are
// rebuilt from Vyapar on every sync and anything recorded into them would
// be silently overwritten the next morning.
import { prisma } from "@/lib/prisma";

import { matchTransaction, type MatchCustomer, type MatchRule } from "./matcher";
import { fingerprint, parseStatementFile, withOccurrences } from "./statementParser";
import type { ParsedStatement } from "./types";

/** How far back a bill is still "recent" for exact-amount corroboration. */
const RECENT_BILL_DAYS = 120;
const MAX_BILLS_PER_CUSTOMER = 40;

export type ImportOutcome = {
  importId: string;
  accountId: string;
  accountLabel: string;
  filename: string;
  rowsParsed: number;
  rowsImported: number;
  rowsDuplicate: number;
  autoMatched: number;
  needsReview: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  warnings: string[];
};

export type MatchContext = { customers: MatchCustomer[]; rules: MatchRule[] };

/**
 * Everything the matcher needs, loaded once per import (or per screenful of
 * transactions) rather than per row.
 */
export async function loadMatchContext(companyId: string): Promise<MatchContext> {
  const since = new Date(Date.now() - RECENT_BILL_DAYS * 86_400_000);

  const [customers, invoices, rules] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId },
      select: { id: true, name: true, phone: true, currentBalance: true },
    }),
    prisma.invoice.findMany({
      where: { companyId, type: { in: ["SALE", "OPENING_BALANCE"] }, invoiceDate: { gte: since } },
      select: { customerId: true, totalAmount: true },
      orderBy: { invoiceDate: "desc" },
    }),
    prisma.bankMatchRule.findMany({
      where: { companyId },
      select: { counterpartyKey: true, customerId: true, hits: true },
    }),
  ]);

  const billsByCustomer = new Map<string, number[]>();
  for (const inv of invoices) {
    const bills = billsByCustomer.get(inv.customerId) ?? [];
    if (bills.length >= MAX_BILLS_PER_CUSTOMER) continue;
    bills.push(inv.totalAmount.toNumber());
    billsByCustomer.set(inv.customerId, bills);
  }

  return {
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      balance: c.currentBalance.toNumber(),
      recentBillAmounts: billsByCustomer.get(c.id) ?? [],
    })),
    rules,
  };
}

function accountLabel(bankName: string, last4: string): string {
  return last4 ? `${bankName} ••${last4}` : bankName;
}

/**
 * Finds (or opens) the account a statement belongs to. Statements rarely
 * name the bank in a machine-readable way, so an unnamed one becomes a
 * single "Bank account" rather than a new account per upload.
 */
export async function resolveAccount(
  companyId: string,
  hint: { bankName: string | null; accountLast4: string | null },
): Promise<{ id: string; label: string }> {
  const bankName = hint.bankName ?? "Bank account";
  const last4 = hint.accountLast4 ?? "";

  const existing = await prisma.bankAccount.findUnique({
    where: { companyId_bankName_accountLast4: { companyId, bankName, accountLast4: last4 } },
  });
  if (existing) return { id: existing.id, label: existing.label };

  // A statement that finally names the account number should adopt the
  // account already opened for the same bank without one, rather than
  // splitting one real account into two.
  if (last4) {
    const unnumbered = await prisma.bankAccount.findUnique({
      where: { companyId_bankName_accountLast4: { companyId, bankName, accountLast4: "" } },
    });
    if (unnumbered) {
      const updated = await prisma.bankAccount.update({
        where: { id: unnumbered.id },
        data: { accountLast4: last4, label: accountLabel(bankName, last4) },
      });
      return { id: updated.id, label: updated.label };
    }
  }

  const created = await prisma.bankAccount.create({
    data: { companyId, bankName, accountLast4: last4, label: accountLabel(bankName, last4) },
  });
  return { id: created.id, label: created.label };
}

export type ImportRequest = {
  companyId: string;
  filename: string;
  bytes: Buffer;
  source: "UPLOAD" | "DRIVE";
  /** Drive file id, so the daily job never reads the same file twice. */
  externalId?: string | null;
};

/** True when this exact Drive file has already been read in. */
export async function alreadyImported(companyId: string, externalId: string): Promise<boolean> {
  const existing = await prisma.bankStatementImport.findUnique({
    where: { companyId_externalId: { companyId, externalId } },
  });
  return existing !== null;
}

export async function importStatement(req: ImportRequest): Promise<ImportOutcome> {
  const parsed: ParsedStatement = await parseStatementFile(req.filename, req.bytes);
  return persistStatement(req, parsed);
}

/** The database half of an import, split out so it can be given a
 * statement parsed elsewhere (and tested without a file). */
export async function persistStatement(req: ImportRequest, parsed: ParsedStatement): Promise<ImportOutcome> {
  const { companyId } = req;
  const account = await resolveAccount(companyId, parsed.account);
  const context = await loadMatchContext(companyId);

  const statementImport = await prisma.bankStatementImport.create({
    data: {
      companyId,
      accountId: account.id,
      source: req.source,
      filename: req.filename,
      fileSize: req.bytes.length,
      externalId: req.externalId ?? null,
      rowsParsed: parsed.transactions.length,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      errorMessage: parsed.warnings.length ? parsed.warnings.slice(0, 30).join("\n") : null,
    },
  });

  const numbered = withOccurrences(parsed.transactions);
  const prints = numbered.map(({ txn, occurrence }) => fingerprint(account.id, txn, occurrence));

  const existing = await prisma.bankTransaction.findMany({
    where: { companyId, fingerprint: { in: prints } },
    select: { fingerprint: true },
  });
  const seen = new Set(existing.map((e) => e.fingerprint));

  let autoMatched = 0;
  let needsReview = 0;
  const rows = [];

  for (let i = 0; i < numbered.length; i++) {
    const print = prints[i]!;
    if (seen.has(print)) continue;
    seen.add(print); // guards against a file that repeats a line verbatim

    const { txn } = numbered[i]!;
    const outcome = matchTransaction(
      { description: txn.description, reference: txn.reference, amount: txn.amount, direction: txn.direction },
      context,
    );

    // Only money in is reconciled against customers automatically. A debit
    // is the shop paying someone; it is kept, and can still be tagged by
    // hand, but a name match on it must not book a receipt.
    const auto = txn.direction === "CREDIT" ? outcome.auto : null;
    if (auto) autoMatched++;
    else if (txn.direction === "CREDIT") needsReview++;

    rows.push({
      companyId,
      accountId: account.id,
      importId: statementImport.id,
      txnDate: txn.date,
      valueDate: txn.valueDate,
      description: txn.description,
      reference: txn.reference,
      direction: txn.direction,
      amount: txn.amount,
      balanceAfter: txn.balanceAfter,
      fingerprint: print,
      counterparty: outcome.counterparty,
      counterpartyKey: outcome.counterpartyKey,
      // A line the matcher has a guess for is marked SUGGESTED rather than
      // UNMATCHED: both wait for a person, but the distinction is what lets
      // the queue be worked guesses-first when there is a pile of it.
      status: auto ? ("MATCHED" as const) : outcome.suggestions.length ? ("SUGGESTED" as const) : ("UNMATCHED" as const),
      customerId: auto?.customerId ?? null,
      matchedBy: auto?.source ?? null,
      matchConfidence: auto?.confidence ?? null,
      reconciledAt: auto ? new Date() : null,
    });
  }

  if (rows.length) {
    await prisma.bankTransaction.createMany({ data: rows, skipDuplicates: true });
  }

  const updated = await prisma.bankStatementImport.update({
    where: { id: statementImport.id },
    data: {
      rowsImported: rows.length,
      rowsDuplicate: parsed.transactions.length - rows.length,
      autoMatched,
    },
  });

  return {
    importId: updated.id,
    accountId: account.id,
    accountLabel: account.label,
    filename: req.filename,
    rowsParsed: parsed.transactions.length,
    rowsImported: rows.length,
    rowsDuplicate: parsed.transactions.length - rows.length,
    autoMatched,
    needsReview,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    warnings: parsed.warnings,
  };
}
