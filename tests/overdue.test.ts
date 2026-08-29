import { readFileSync, rmSync } from "fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../src/lib/prisma";
import { persistExtract } from "../src/lib/sync/syncEngine";
import { readVyaparExtract } from "../src/lib/sync/vyaparReader";
import { unpackVyb, cleanupExtractDir } from "../src/lib/sync/unpackVyb";
import { DEFAULT_REMINDER_TEMPLATE, getOverdueCustomers, renderReminder } from "../src/lib/overdue";
import { getQuickMetrics } from "../src/lib/metrics";
import { makeFixtureVyb } from "./fixtures/makeVyb";

// Needs a Postgres to write into - see the "test" script in package.json and
// the CI workflow, both of which point DATABASE_URL at a throwaway database.

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID!;

async function resetDb() {
  await prisma.brokerageTransaction.deleteMany({});
  await prisma.brokerageBrokerSummary.deleteMany({});
  await prisma.brokeragePayment.deleteMany({});
  await prisma.brokerageReport.deleteMany({});
  await prisma.invoiceLineItem.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.overdueSettings.deleteMany({});
  await prisma.syncRun.deleteMany({});
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    update: {},
    create: { id: COMPANY_ID, name: "Test Co" },
  });
}

describe("overdue", () => {
  let fixtureDir: string;

  beforeAll(async () => {
    await resetDb();
    const { vybPath, dir } = makeFixtureVyb();
    fixtureDir = dir;
    const { vypPath, extractDir } = unpackVyb(readFileSync(vybPath));
    const extract = readVyaparExtract(vypPath);
    cleanupExtractDir(extractDir);
    await persistExtract(COMPANY_ID, extract, 15);
  });

  afterAll(async () => {
    rmSync(fixtureDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("totals outstanding from the parties' own balances", () => {
    // 5000 + 2000 + 0 + 1500. Emphatically not the sum of invoice amounts.
    return expect(getQuickMetrics(COMPANY_ID)).resolves.toMatchObject({ totalOutstanding: 8500 });
  });

  it("excludes a customer who owes nothing", async () => {
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    expect(customers.map((c) => c.party)).not.toContain("Priya Traders");
  });

  it("spreads a balance across invoices so the parts sum to the whole", async () => {
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    for (const c of customers) {
      const allocated = c.invoices.reduce((s, i) => s + i.unpaid, 0);
      // Every rupee owed is either overdue or not-yet-due, never lost.
      expect(allocated).toBeCloseTo(c.overdueAmount + c.upcomingAmount, 2);
      expect(allocated).toBeLessThanOrEqual(c.balance + 0.01);
    }
  });

  it("applies payments oldest-first, leaving the newest bills outstanding", async () => {
    // Ramesh has sales of 3000 (100d), 2000 (60d) and 4000 (3d) but owes
    // only 5000. Oldest-cleared-first means the 4000 and part of the 2000
    // remain - the 100-day-old bill should be treated as settled.
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    const ramesh = customers.find((c) => c.party === "Ramesh Kirana")!;
    expect(ramesh.balance).toBe(5000);

    const newest = ramesh.invoices.find((i) => i.invoiceNumber === "INV-1002")!;
    const oldest = ramesh.invoices.find((i) => i.invoiceNumber === "INV-1000");
    expect(newest.unpaid).toBe(4000);
    // The oldest sale is fully covered by later payments, so it either drops
    // out of the list or carries nothing.
    expect(oldest?.unpaid ?? 0).toBe(0);
  });

  it("counts a bill as overdue only once past its credit period", async () => {
    // Ramesh's remaining debt sits on a 3-day-old and a 60-day-old bill.
    // At 25 days' credit the recent one is not yet due.
    const { customers } = await getOverdueCustomers(COMPANY_ID, 25);
    const ramesh = customers.find((c) => c.party === "Ramesh Kirana")!;
    const recent = ramesh.invoices.find((i) => i.invoiceNumber === "INV-1002")!;
    expect(recent.isOverdue).toBe(false);
    expect(ramesh.upcomingAmount).toBe(4000);
    expect(ramesh.overdueAmount).toBe(1000); // the 60-day-old remainder
  });

  it("moves money between overdue and upcoming as the credit period changes", async () => {
    const strict = await getOverdueCustomers(COMPANY_ID, 0);
    const lenient = await getOverdueCustomers(COMPANY_ID, 200);
    expect(strict.summary.totalOverdue).toBeGreaterThan(lenient.summary.totalOverdue);
    // Nothing is due at all under a very long credit period.
    expect(lenient.summary.totalOverdue).toBe(0);
    // Total owed never moves - only how it's classified.
    expect(strict.summary.totalOutstanding).toBe(lenient.summary.totalOutstanding);
  });

  it("lets a per-customer credit period override the company default", async () => {
    const before = await getOverdueCustomers(COMPANY_ID);
    expect(before.customers.map((c) => c.party)).toContain("Ramesh Kirana");

    const ramesh = await prisma.customer.findFirstOrThrow({ where: { name: "Ramesh Kirana" } });
    await prisma.customer.update({ where: { id: ramesh.id }, data: { creditDays: 300 } });
    try {
      const after = await getOverdueCustomers(COMPANY_ID);
      expect(after.customers.map((c) => c.party)).not.toContain("Ramesh Kirana");
      const anil = after.customers.find((c) => c.party === "Anil Shop")!;
      expect(anil.creditDaysCustom).toBe(false); // others keep the default
    } finally {
      await prisma.customer.update({ where: { id: ramesh.id }, data: { creditDays: null } });
    }
  });

  it("shows an opening balance as debt in its own right", async () => {
    // Suresh has no invoices at all - only a carried-over balance. Before
    // this was handled he appeared overdue with no bills and an empty
    // reminder listing zero bills.
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    const suresh = customers.find((c) => c.party === "Suresh Stores")!;
    expect(suresh.overdueAmount).toBe(2000);
    expect(suresh.invoiceCount).toBe(1);
    expect(suresh.invoices[0]!.isOpeningBalance).toBe(true);
    expect(suresh.reminderMessage).toContain("Purana baki");
    expect(suresh.reminderMessage).not.toContain("0 bill");
  });

  it("fills every placeholder in the reminder template", async () => {
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    const c = customers.find((x) => x.party === "Suresh Stores")!;
    const rendered = renderReminder(
      "{party}|{amount}|{balance}|{days}|{invoice_count}|{credit_days}|{invoice_lines}",
      c,
    );
    expect(rendered).not.toMatch(/\{[a-z_]+\}/); // nothing left unsubstituted
    expect(rendered.startsWith("Suresh Stores|2,000|2,000|")).toBe(true);
  });

  it("uses the default template wording when none is configured", async () => {
    const { reminderTemplate } = await getOverdueCustomers(COMPANY_ID);
    expect(reminderTemplate).toBe(DEFAULT_REMINDER_TEMPLATE);
  });

  it("sorts the most overdue customer first", async () => {
    const { customers } = await getOverdueCustomers(COMPANY_ID, 0);
    for (let i = 1; i < customers.length; i++) {
      expect(customers[i - 1]!.maxDaysOverdue).toBeGreaterThanOrEqual(customers[i]!.maxDaysOverdue);
    }
  });
});

describe("sync", () => {
  it("keeps a hand-entered phone number when Vyapar has none", async () => {
    // The nightly sync used to blank these out, silently disabling the
    // WhatsApp reminder for exactly the customers who needed one added.
    const anil = await prisma.customer.findFirstOrThrow({ where: { name: "Anil Shop" } });
    expect(anil.phone).toBeNull();
    await prisma.customer.update({
      where: { id: anil.id },
      data: { phone: "9998887777", note: "added by hand", creditDays: 7 },
    });

    const { vybPath, dir } = makeFixtureVyb();
    try {
      const { vypPath, extractDir } = unpackVyb(readFileSync(vybPath));
      const extract = readVyaparExtract(vypPath);
      cleanupExtractDir(extractDir);
      await persistExtract(process.env.DEFAULT_COMPANY_ID!, extract, 15);

      const after = await prisma.customer.findUniqueOrThrow({ where: { id: anil.id } });
      expect(after.phone).toBe("9998887777");
      expect(after.note).toBe("added by hand");
      expect(after.creditDays).toBe(7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await prisma.customer.update({
        where: { id: anil.id },
        data: { phone: null, note: null, creditDays: null },
      });
    }
  });

  it("re-syncing the same backup does not duplicate anything", async () => {
    const before = {
      customers: await prisma.customer.count(),
      invoices: await prisma.invoice.count(),
      lineItems: await prisma.invoiceLineItem.count(),
    };

    const { vybPath, dir } = makeFixtureVyb();
    try {
      const { vypPath, extractDir } = unpackVyb(readFileSync(vybPath));
      const extract = readVyaparExtract(vypPath);
      cleanupExtractDir(extractDir);
      await persistExtract(process.env.DEFAULT_COMPANY_ID!, extract, 15);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect({
      customers: await prisma.customer.count(),
      invoices: await prisma.invoice.count(),
      lineItems: await prisma.invoiceLineItem.count(),
    }).toEqual(before);
  });
});
