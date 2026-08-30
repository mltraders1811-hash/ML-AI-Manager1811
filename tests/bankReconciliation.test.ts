import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  assignTransaction,
  getBankSummary,
  ignoreTransaction,
  listTransactions,
  unassignTransaction,
} from "../src/lib/bank/bankService";
import { importStatement } from "../src/lib/bank/importService";
import { istDateString } from "../src/lib/dateIst";
import { prisma } from "../src/lib/prisma";

// Needs a Postgres to write into - same throwaway database the other tests
// use (see the CI workflow).

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID!;

/** Today, as the statement itself would write it, so "this month" figures
 * are exercised rather than sidestepped. */
function todayDdMmYyyy(): string {
  const [y, m, d] = istDateString(new Date()).split("-");
  return `${d}/${m}/${y}`;
}

function statement(rows: { date?: string; narration: string; credit?: number; debit?: number }[]): Buffer {
  const lines = ["Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance"];
  for (const row of rows) {
    lines.push(
      [
        row.date ?? todayDdMmYyyy(),
        `"${row.narration}"`,
        "",
        row.debit ? row.debit.toFixed(2) : "",
        row.credit ? row.credit.toFixed(2) : "",
        "",
      ].join(","),
    );
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

function importFile(bytes: Buffer, filename = "hdfc-statement.csv") {
  return importStatement({ companyId: COMPANY_ID, filename, bytes, source: "UPLOAD" });
}

async function addCustomer(name: string, opts: { phone?: string; balance?: number; billAmount?: number } = {}) {
  const customer = await prisma.customer.create({
    data: {
      companyId: COMPANY_ID,
      externalId: `ext-${name.replace(/\W/g, "")}`,
      name,
      phone: opts.phone ?? null,
      currentBalance: opts.balance ?? 0,
    },
  });
  if (opts.billAmount) {
    await prisma.invoice.create({
      data: {
        companyId: COMPANY_ID,
        externalId: `inv-${customer.id}`,
        customerId: customer.id,
        type: "SALE",
        invoiceDate: new Date(),
        totalAmount: opts.billAmount,
        paidAmount: 0,
        balanceAmount: opts.billAmount,
      },
    });
  }
  return customer;
}

async function reset() {
  await prisma.bankTransaction.deleteMany({});
  await prisma.bankStatementImport.deleteMany({});
  await prisma.bankMatchRule.deleteMany({});
  await prisma.bankAccount.deleteMany({});
  await prisma.invoiceLineItem.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    update: {},
    create: { id: COMPANY_ID, name: "Test Co" },
  });
}

describe("reading a statement in", () => {
  beforeEach(async () => {
    await reset();
    await addCustomer("Sharma Traders", { phone: "9876543210", balance: 48000, billAmount: 25000 });
    await addCustomer("Verma Agency", { balance: 12000 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("matches a payment the narration names and the amount confirms", async () => {
    const outcome = await importFile(
      statement([{ narration: "UPI/CR/451203377421/SHARMA TRAD/HDFC/Payment", credit: 25000 }]),
    );
    expect(outcome.rowsImported).toBe(1);
    expect(outcome.autoMatched).toBe(1);

    const { transactions } = await listTransactions(COMPANY_ID, { view: "assigned" });
    expect(transactions[0]).toMatchObject({ status: "MATCHED", matchedBy: "AUTO_NAME" });
    expect(transactions[0]!.customer?.name).toBe("Sharma Traders");
  });

  it("leaves an unrecognised payer for a person to name", async () => {
    await importFile(statement([{ narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 5000 }]));

    const { transactions } = await listTransactions(COMPANY_ID, { view: "review" });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ status: "UNMATCHED", counterparty: "RAHUL KUMAR" });
    expect(transactions[0]!.suggestions).toHaveLength(0);
  });

  it("marks a named payment it isn't sure about as a guess, not a decision", async () => {
    // The narration names Sharma Traders, but ₹4,321 settles nothing of
    // theirs - a name on its own suggests, it never decides.
    await importFile(statement([{ narration: "UPI/CR/451203377421/SHARMA TRAD/HDFC", credit: 4321 }]));

    const { transactions } = await listTransactions(COMPANY_ID, { view: "review" });
    expect(transactions[0]!.status).toBe("SUGGESTED");
    expect(transactions[0]!.customer).toBeNull();
    expect(transactions[0]!.suggestions[0]?.name).toBe("Sharma Traders");
  });

  it("never books money going out against a customer", async () => {
    await importFile(statement([{ narration: "NEFT DR/SHARMA TRADERS/REFUND", debit: 25000 }]));

    const row = await prisma.bankTransaction.findFirstOrThrow({ where: { companyId: COMPANY_ID } });
    expect(row.direction).toBe("DEBIT");
    expect(row.customerId).toBeNull();
  });

  it("reads the same file twice without doubling the month", async () => {
    const file = statement([
      { narration: "UPI/CR/451203377421/SHARMA TRAD/HDFC", credit: 25000 },
      { narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 5000 },
    ]);
    await importFile(file);
    const second = await importFile(file);

    expect(second.rowsImported).toBe(0);
    expect(second.rowsDuplicate).toBe(2);
    expect(await prisma.bankTransaction.count({ where: { companyId: COMPANY_ID } })).toBe(2);
  });

  it("adds only the new lines from an overlapping later statement", async () => {
    const rows = [
      { narration: "UPI/CR/451203377421/SHARMA TRAD/HDFC", credit: 25000 },
      { narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 5000 },
    ];
    await importFile(statement(rows));
    const second = await importFile(
      statement([...rows, { narration: "UPI/CR/9931/VERMA AGENCY/AXIS", credit: 12000 }]),
    );

    expect(second.rowsImported).toBe(1);
    expect(second.rowsDuplicate).toBe(2);
    expect(await prisma.bankTransaction.count({ where: { companyId: COMPANY_ID } })).toBe(3);
  });

  it("keeps two identical payments on one day as two payments", async () => {
    const outcome = await importFile(
      statement([
        { narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 5000 },
        { narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 5000 },
      ]),
    );
    expect(outcome.rowsImported).toBe(2);
  });
});

describe("saying whose payment it is", () => {
  let sharma: { id: string };

  beforeEach(async () => {
    await reset();
    sharma = await addCustomer("Sharma Traders", { balance: 48000 });
    await addCustomer("Verma Agency", { balance: 12000 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records the decision and remembers the payer for next time", async () => {
    await importFile(statement([{ narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 5000 }]));
    const { transactions } = await listTransactions(COMPANY_ID, { view: "review" });

    const { transaction } = await assignTransaction(COMPANY_ID, transactions[0]!.id, sharma.id);
    expect(transaction).toMatchObject({ status: "MATCHED", matchedBy: "MANUAL", matchConfidence: 100 });

    const rule = await prisma.bankMatchRule.findFirstOrThrow({ where: { companyId: COMPANY_ID } });
    expect(rule).toMatchObject({ counterpartyKey: "RAHUL KUMAR", customerId: sharma.id, hits: 1 });

    // Next month's statement, same payer, different amount: no longer a question.
    const next = await importFile(
      statement([{ date: "01/07/2026", narration: "IMPS/P2A/9912/RAHUL KUMAR", credit: 3300 }]),
      "hdfc-july.csv",
    );
    expect(next.autoMatched).toBe(1);
    const auto = await prisma.bankTransaction.findFirstOrThrow({ where: { companyId: COMPANY_ID, amount: 3300 } });
    expect(auto).toMatchObject({ customerId: sharma.id, matchedBy: "AUTO_RULE" });
  });

  it("clears the payer's other waiting entries in one tap", async () => {
    await importFile(
      statement([
        { narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 5000 },
        { narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 7000 },
        { date: "02/07/2026", narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 9000 },
      ]),
    );

    const { transactions } = await listTransactions(COMPANY_ID, { view: "review" });
    expect(transactions[0]!.similarPending).toBe(2);

    const { alsoApplied } = await assignTransaction(COMPANY_ID, transactions[0]!.id, sharma.id, {
      applySimilar: true,
    });
    expect(alsoApplied).toBe(2);
    expect(await prisma.bankTransaction.count({ where: { companyId: COMPANY_ID, status: "UNMATCHED" } })).toBe(0);
  });

  it("forgets the rule when a wrong match is undone", async () => {
    await importFile(statement([{ narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 5000 }]));
    const { transactions } = await listTransactions(COMPANY_ID, { view: "review" });

    await assignTransaction(COMPANY_ID, transactions[0]!.id, sharma.id);
    const back = await unassignTransaction(COMPANY_ID, transactions[0]!.id);

    expect(back.status).toBe("UNMATCHED");
    expect(await prisma.bankMatchRule.count({ where: { companyId: COMPANY_ID } })).toBe(0);
  });

  it("takes an entry that isn't a customer payment out of the queue", async () => {
    await importFile(statement([{ narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 5000 }]));
    const { transactions } = await listTransactions(COMPANY_ID, { view: "review" });

    const ignored = await ignoreTransaction(COMPANY_ID, transactions[0]!.id, "Loan from brother");
    expect(ignored).toMatchObject({ status: "IGNORED", ignoreReason: "Loan from brother" });

    const review = await listTransactions(COMPANY_ID, { view: "review" });
    expect(review.transactions).toHaveLength(0);
  });
});

describe("the bank summary", () => {
  beforeEach(async () => {
    await reset();
    await addCustomer("Sharma Traders", { balance: 48000, billAmount: 25000 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("counts what came in, what is still unnamed, and what was matched for you", async () => {
    await importFile(
      statement([
        { narration: "UPI/CR/451203377421/SHARMA TRAD/HDFC", credit: 25000 },
        { narration: "IMPS/P2A/8891/RAHUL KUMAR", credit: 5000 },
        { narration: "ATM/CASH WDL/4471", debit: 2000 },
      ]),
    );

    const summary = await getBankSummary(COMPANY_ID);
    expect(summary.hasData).toBe(true);
    expect(summary.needsReview).toEqual({ count: 1, amount: 5000 });
    expect(summary.thisMonth.received).toBe(30000);
    expect(summary.thisMonth.paidOut).toBe(2000);
    expect(summary.thisMonth.unassigned).toBe(5000);
    expect(summary.autoMatchedThisMonth).toBe(1);
    expect(summary.lastImport).toMatchObject({ filename: "hdfc-statement.csv", source: "UPLOAD" });
  });

  it("says nothing has been read in before the first statement", async () => {
    const summary = await getBankSummary(COMPANY_ID);
    expect(summary.hasData).toBe(false);
    expect(summary.lastImport).toBeNull();
    expect(summary.accounts).toHaveLength(0);
  });
});
