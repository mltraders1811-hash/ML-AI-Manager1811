import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getAlertActivity, ingestAlert, matchTrackedAccount } from "../src/lib/bank/alertService";
import { assignTransaction, getBankSummary, listTransactions } from "../src/lib/bank/bankService";
import { importStatement } from "../src/lib/bank/importService";
import { istDateString } from "../src/lib/dateIst";
import { prisma } from "../src/lib/prisma";

// Needs a Postgres to write into - same throwaway database as the other
// suites (see the CI workflow).

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID!;

function todayParts() {
  const [y, m, d] = istDateString(new Date()).split("-") as [string, string, string];
  return { y, m, d };
}

/** Today as a bank writes it in an SMS: "05-08-26". */
function smsDate(): string {
  const { y, m, d } = todayParts();
  return `${d}-${m}-${y.slice(2)}`;
}

function statementDate(): string {
  const { y, m, d } = todayParts();
  return `${d}/${m}/${y}`;
}

function alert(text: string, sender = "AD-HDFCBK", accountsLast4: string[] = [], banks: string[] = []) {
  return ingestAlert({ companyId: COMPANY_ID, text, sender, accountsLast4, banks });
}

async function addCustomer(name: string, opts: { balance?: number; billAmount?: number } = {}) {
  const customer = await prisma.customer.create({
    data: {
      companyId: COMPANY_ID,
      externalId: `ext-${name.replace(/\W/g, "")}`,
      name,
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
  await prisma.bankAlertLog.deleteMany({});
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

describe("a bank SMS forwarded from the phone", () => {
  beforeEach(async () => {
    await reset();
    await addCustomer("Sharma Traders", { balance: 48000, billAmount: 25000 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("becomes a payment on the bank screen, matched where it can be", async () => {
    const result = await alert(
      `Rs.25000.00 credited to a/c XXXXXX4471 on ${smsDate()} by a/c linked to VPA sharmatraders@okhdfcbank (UPI Ref No 451203377421).`,
    );

    expect(result).toMatchObject({ status: "booked", amount: 25000, direction: "CREDIT" });
    const { transactions } = await listTransactions(COMPANY_ID, { view: "all" });
    expect(transactions[0]).toMatchObject({ status: "MATCHED", accountLabel: "HDFC ••4471" });
    expect(transactions[0]!.customer?.name).toBe("Sharma Traders");
  });

  it("leaves an unknown payer waiting, like any other credit", async () => {
    await alert(`Rs.5000 credited to a/c XX4471 on ${smsDate()} by Rahul Kumar (UPI Ref no 9988776655).`);

    const { transactions } = await listTransactions(COMPANY_ID, { view: "review" });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.customer).toBeNull();
  });

  it("does not book the same message twice when the forwarder retries", async () => {
    const text = `Rs.5000 credited to a/c XX4471 on ${smsDate()} by Rahul Kumar (UPI Ref no 9988776655).`;
    await alert(text);
    const second = await alert(text);

    expect(second.status).toBe("duplicate");
    expect(await prisma.bankTransaction.count({ where: { companyId: COMPANY_ID } })).toBe(1);
  });

  it("keeps out messages about another account", async () => {
    const result = await alert(
      `Rs.9000 credited to a/c XX9920 on ${smsDate()} by Someone Else (UPI Ref no 12345678).`,
      "AD-HDFCBK",
      ["4471"],
    );

    expect(result).toMatchObject({ status: "ignored" });
    if (result.status === "ignored") expect(result.reason).toMatch(/9920/);
    expect(await prisma.bankTransaction.count({ where: { companyId: COMPANY_ID } })).toBe(0);
  });

  it("books a message about a tracked account when a filter is set", async () => {
    const result = await alert(
      `Rs.9000 credited to a/c XX4471 on ${smsDate()} by Rahul Kumar (UPI Ref no 12345678).`,
      "AD-HDFCBK",
      ["4471", "9920"],
    );
    expect(result.status).toBe("booked");
  });

  it("records what it did with every message, including the ones it skipped", async () => {
    await alert(`Rs.5000 credited to a/c XX4471 on ${smsDate()} by Rahul Kumar (UPI Ref no 9988776655).`);
    await alert("You have received a collect request of Rs.5000 from rahul@ybl. Approve in your UPI app.");

    const activity = await getAlertActivity(COMPANY_ID);
    expect(activity).toMatchObject({ booked: 1, ignored: 1 });
    expect(activity.lastAt).not.toBeNull();

    const skipped = await prisma.bankAlertLog.findFirstOrThrow({ where: { companyId: COMPANY_ID, status: "IGNORED" } });
    expect(skipped.reason).toMatch(/collect request/i);
    expect(skipped.body).toContain("collect request");
  });
});

describe("taking only one bank's messages, for one account", () => {
  // The shop's own setup: ICICI, account ending 1811. Everything else the
  // phone receives - the personal HDFC account, another ICICI account - has
  // to stay out of the books.
  const TRACKED = ["1811"];
  const BANKS = ["ICICI"];

  beforeEach(async () => {
    await reset();
    await addCustomer("Sharma Traders", { balance: 48000, billAmount: 25000 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("books the ICICI message for that account", async () => {
    const result = await alert(
      `Dear Customer, Acct XX1811 is credited with Rs 25,000.00 on ${smsDate()} from SHARMA TRADERS. UPI:451203377421-ICICI Bank.`,
      "AD-ICICIB",
      TRACKED,
      BANKS,
    );
    expect(result).toMatchObject({ status: "booked", amount: 25000, accountLabel: "ICICI ••1811" });
  });

  it("books it even when ICICI masks the account to three digits", async () => {
    // ICICI writes "XX811" for an account ending 1811; a strict comparison
    // would throw away every message the shop actually cares about.
    const result = await alert(
      `ICICI Bank Acct XX811 credited with Rs 5,000.00 on ${smsDate()}. Info: UPI/451203377/SHARMA TRADERS. Available Balance is Rs 1,25,000.00`,
      "AD-ICICIT",
      TRACKED,
      BANKS,
    );
    expect(result).toMatchObject({ status: "booked", amount: 5000 });

    // And it is the same account as the four-digit form, not a second one.
    expect(await prisma.bankAccount.count({ where: { companyId: COMPANY_ID } })).toBe(1);
    const account = await prisma.bankAccount.findFirstOrThrow({ where: { companyId: COMPANY_ID } });
    expect(account.accountLast4).toBe("1811");
  });

  it("skips another ICICI account on the same phone", async () => {
    const result = await alert(
      `Dear Customer, Acct XX9920 is credited with Rs 9,000.00 on ${smsDate()} from Someone Else. UPI:99887766-ICICI Bank.`,
      "AD-ICICIB",
      TRACKED,
      BANKS,
    );
    expect(result).toMatchObject({ status: "ignored" });
    if (result.status === "ignored") expect(result.reason).toMatch(/9920/);
    expect(await prisma.bankTransaction.count({ where: { companyId: COMPANY_ID } })).toBe(0);
  });

  it("skips another bank's message even for an account ending the same", async () => {
    const result = await alert(
      `Rs.7000.00 credited to a/c XXXXXX1811 on ${smsDate()} by a/c linked to VPA someone@okhdfcbank (UPI Ref No 5566778899).`,
      "AD-HDFCBK",
      TRACKED,
      BANKS,
    );
    expect(result).toMatchObject({ status: "ignored" });
    if (result.status === "ignored") expect(result.reason).toMatch(/HDFC/);
  });

  it("refuses a message whose bank cannot be told, rather than guessing", async () => {
    const result = await alert(
      `Acct XX1811 is credited with Rs 4,000.00 on ${smsDate()} from SHARMA TRADERS. Ref 123456789012`,
      "+919812345678",
      TRACKED,
      BANKS,
    );
    expect(result).toMatchObject({ status: "ignored" });
    if (result.status === "ignored") expect(result.reason).toMatch(/which bank/i);
  });

  it("keeps every skipped message on the record with its reason", async () => {
    await alert(
      `Rs.7000.00 credited to a/c XXXXXX1811 on ${smsDate()} by Someone (UPI Ref No 5566778899).`,
      "AD-HDFCBK",
      TRACKED,
      BANKS,
    );
    const skipped = await prisma.bankAlertLog.findFirstOrThrow({ where: { companyId: COMPANY_ID } });
    expect(skipped).toMatchObject({ status: "IGNORED", sender: "AD-HDFCBK" });
    expect(skipped.reason).toMatch(/tracked banks/);
  });

  it("matches a masked account by its common suffix, and only that far", () => {
    expect(matchTrackedAccount("811", ["1811"])).toBe("1811");
    expect(matchTrackedAccount("1811", ["1811"])).toBe("1811");
    expect(matchTrackedAccount("21811", ["1811"])).toBe("1811");
    expect(matchTrackedAccount("9920", ["1811"])).toBeNull();
    expect(matchTrackedAccount("11", ["1811"])).toBeNull(); // too short to mean anything
  });
});

describe("when the statement arrives after the SMS", () => {
  beforeEach(async () => {
    await reset();
    await addCustomer("Sharma Traders", { balance: 48000 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function statementFor(narration: string, amount: number, ref = "") {
    const lines = [
      "Account No :XXXXXXXX4471",
      "Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance",
      `${statementDate()},"${narration}",${ref},,${amount.toFixed(2)},`,
    ];
    return importStatement({
      companyId: COMPANY_ID,
      filename: "HDFC-statement.csv",
      bytes: Buffer.from(lines.join("\n"), "utf8"),
      source: "UPLOAD",
    });
  }

  it("replaces the provisional SMS line instead of counting the payment twice", async () => {
    await alert(`Rs.25000.00 credited to a/c XX4471 on ${smsDate()} by Rahul Kumar (UPI Ref No 451203377421).`);
    const outcome = await statementFor("UPI/CR/451203377421/RAHUL KUMAR", 25000, "451203377421");

    expect(outcome.supersededAlerts).toBe(1);
    const rows = await prisma.bankTransaction.findMany({ where: { companyId: COMPANY_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.origin).toBe("STATEMENT");

    const summary = await getBankSummary(COMPANY_ID);
    expect(summary.thisMonth.received).toBe(25000);
  });

  it("carries the customer you already named onto the statement line", async () => {
    const booked = await alert(`Rs.25000.00 credited to a/c XX4471 on ${smsDate()} by Rahul Kumar (UPI Ref No 4512033).`);
    if (booked.status !== "booked") throw new Error("expected the alert to be booked");

    const customer = await prisma.customer.findFirstOrThrow({ where: { companyId: COMPANY_ID } });
    await assignTransaction(COMPANY_ID, booked.transactionId, customer.id);

    await statementFor("UPI/CR/4512033/RAHUL KUMAR", 25000, "4512033");

    const row = await prisma.bankTransaction.findFirstOrThrow({ where: { companyId: COMPANY_ID } });
    expect(row).toMatchObject({ origin: "STATEMENT", status: "MATCHED", customerId: customer.id });
  });

  it("keeps a different payment on the same day as its own line", async () => {
    await alert(`Rs.25000.00 credited to a/c XX4471 on ${smsDate()} by Rahul Kumar (UPI Ref No 451203377421).`);
    const outcome = await statementFor("UPI/CR/999888/GUPTA STORES", 7000, "999888");

    expect(outcome.supersededAlerts).toBe(0);
    expect(await prisma.bankTransaction.count({ where: { companyId: COMPANY_ID } })).toBe(2);
  });

  it("does not merge two payments whose references disagree", async () => {
    await alert(`Rs.25000.00 credited to a/c XX4471 on ${smsDate()} by Rahul Kumar (UPI Ref No 451203377421).`);
    const outcome = await statementFor("UPI/CR/777666/RAHUL KUMAR", 25000, "777666");

    expect(outcome.supersededAlerts).toBe(0);
    expect(await prisma.bankTransaction.count({ where: { companyId: COMPANY_ID } })).toBe(2);
  });

  it("ignores an SMS for a payment the statement already brought in", async () => {
    await statementFor("UPI/CR/451203377421/RAHUL KUMAR", 25000, "451203377421");
    const result = await alert(`Rs.25000.00 credited to a/c XX4471 on ${smsDate()} by Rahul Kumar (UPI Ref No 451203377421).`);

    expect(result).toMatchObject({ status: "duplicate" });
    expect(await prisma.bankTransaction.count({ where: { companyId: COMPANY_ID } })).toBe(1);
  });
});
