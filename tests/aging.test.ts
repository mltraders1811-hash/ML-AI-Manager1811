import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/lib/prisma";
import { getOverdueCustomers } from "../src/lib/overdue";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID!;

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** A party with one bill of `amount`, raised `age` days ago, wholly unpaid. */
async function makeParty(name: string, amount: number, age: number) {
  const customer = await prisma.customer.create({
    data: { companyId: COMPANY_ID, externalId: `a-${name}`, name, currentBalance: amount, creditDays: 0 },
  });
  await prisma.invoice.create({
    data: {
      companyId: COMPANY_ID,
      externalId: `ai-${name}`,
      customerId: customer.id,
      type: "SALE",
      invoiceDate: daysAgo(age),
      dueDate: daysAgo(age),
      totalAmount: amount,
      paidAmount: 0,
      balanceAmount: amount,
    },
  });
  return customer;
}

describe("aging buckets", () => {
  beforeEach(async () => {
    await prisma.company.upsert({
      where: { id: COMPANY_ID },
      update: {},
      create: { id: COMPANY_ID, name: "Test Co" },
    });
    await prisma.reminderLog.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.invoiceLineItem.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.invoice.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.customer.deleteMany({ where: { companyId: COMPANY_ID } });
  });

  afterAll(async () => {
    await prisma.reminderLog.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.invoiceLineItem.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.invoice.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.customer.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.$disconnect();
  });

  it("puts each bill in the band matching its own age", async () => {
    await makeParty("Recent", 1000, 10); // 1-30
    await makeParty("Middling", 2000, 45); // 31-60
    await makeParty("Old", 3000, 75); // 61-90
    await makeParty("Ancient", 4000, 200); // 90+

    const { aging } = await getOverdueCustomers(COMPANY_ID, 0);
    const byLabel = Object.fromEntries(aging.map((b) => [b.label, b.amount]));
    expect(byLabel["1-30 din"]).toBe(1000);
    expect(byLabel["31-60 din"]).toBe(2000);
    expect(byLabel["61-90 din"]).toBe(3000);
    expect(byLabel["90+ din"]).toBe(4000);
  });

  it("adds up to the total overdue, so the split can be trusted", async () => {
    await makeParty("A", 1500, 5);
    await makeParty("B", 2500, 40);
    await makeParty("C", 3500, 120);

    const { aging, summary } = await getOverdueCustomers(COMPANY_ID, 0);
    const bucketed = aging.reduce((s, b) => s + b.amount, 0);
    expect(bucketed).toBeCloseTo(summary.totalOverdue, 2);
  });

  it("spreads one customer's bills across several bands", async () => {
    // Rolling a party into their worst bill alone would overstate how stuck
    // the book is - most of this money is recent.
    const cust = await prisma.customer.create({
      data: { companyId: COMPANY_ID, externalId: "multi", name: "Mixed", currentBalance: 9000, creditDays: 0 },
    });
    for (const [i, [amount, age]] of [
      [6000, 5],
      [3000, 150],
    ].entries()) {
      await prisma.invoice.create({
        data: {
          companyId: COMPANY_ID,
          externalId: `mixed-${i}`,
          customerId: cust.id,
          type: "SALE",
          invoiceDate: daysAgo(age!),
          dueDate: daysAgo(age!),
          totalAmount: amount!,
          paidAmount: 0,
          balanceAmount: amount!,
        },
      });
    }

    const { aging } = await getOverdueCustomers(COMPANY_ID, 0);
    const byLabel = Object.fromEntries(aging.map((b) => [b.label, b.amount]));
    expect(byLabel["1-30 din"]).toBe(6000);
    expect(byLabel["90+ din"]).toBe(3000);
  });

  it("counts a customer once per band, not once per bill", async () => {
    const cust = await prisma.customer.create({
      data: { companyId: COMPANY_ID, externalId: "two-bills", name: "Two Bills", currentBalance: 4000, creditDays: 0 },
    });
    for (const [i, age] of [10, 20].entries()) {
      await prisma.invoice.create({
        data: {
          companyId: COMPANY_ID,
          externalId: `tb-${i}`,
          customerId: cust.id,
          type: "SALE",
          invoiceDate: daysAgo(age),
          dueDate: daysAgo(age),
          totalAmount: 2000,
          paidAmount: 0,
          balanceAmount: 2000,
        },
      });
    }

    const { aging } = await getOverdueCustomers(COMPANY_ID, 0);
    const recent = aging.find((b) => b.label === "1-30 din")!;
    expect(recent.amount).toBe(4000);
    expect(recent.customerCount).toBe(1);
  });

  it("moves money to younger bands as the credit period lengthens", async () => {
    await makeParty("Shifter", 5000, 40);

    const strict = await getOverdueCustomers(COMPANY_ID, 0); // 40 days overdue
    const lenient = await getOverdueCustomers(COMPANY_ID, 20); // 20 days overdue
    expect(strict.aging.find((b) => b.label === "31-60 din")!.amount).toBe(5000);
    expect(lenient.aging.find((b) => b.label === "1-30 din")!.amount).toBe(5000);
    expect(lenient.aging.find((b) => b.label === "31-60 din")!.amount).toBe(0);
  });

  it("reports empty bands as zero rather than omitting them", async () => {
    await makeParty("Only Recent", 1000, 3);
    const { aging } = await getOverdueCustomers(COMPANY_ID, 0);
    expect(aging).toHaveLength(4); // the strip keeps its shape
    expect(aging.find((b) => b.label === "90+ din")!.amount).toBe(0);
    expect(aging.find((b) => b.label === "90+ din")!.customerCount).toBe(0);
  });

  it("still banks debt from a customer with no overdue bill at all", async () => {
    // Found in real data: a party owing money whose bills are all inside
    // their credit period, so maxDaysOverdue is 0 and matches no band. The
    // first version of this silently dropped their money from the buckets,
    // which is exactly the kind of quiet shortfall that makes a split
    // untrustworthy.
    const cust = await prisma.customer.create({
      data: { companyId: COMPANY_ID, externalId: "nodate", name: "Undateable", currentBalance: 3000, creditDays: 0 },
    });
    // A bill dated today: not overdue, and far too small to cover the debt.
    await prisma.invoice.create({
      data: {
        companyId: COMPANY_ID,
        externalId: "nodate-inv",
        customerId: cust.id,
        type: "SALE",
        invoiceDate: daysAgo(0),
        dueDate: daysAgo(0),
        totalAmount: 100,
        paidAmount: 0,
        balanceAmount: 100,
      },
    });

    const { aging, summary, customers } = await getOverdueCustomers(COMPANY_ID, 0);
    const c = customers.find((x) => x.party === "Undateable")!;
    expect(c.invoices.filter((i) => i.isOverdue)).toHaveLength(0); // nothing datable
    expect(c.overdueAmount).toBeGreaterThan(0); // but money is owed
    expect(aging.reduce((s, b) => s + b.amount, 0)).toBeCloseTo(summary.totalOverdue, 2);
  });

  it("places debt with no bill behind it in the customer's oldest band", async () => {
    // An opening balance older than the invoice history still has to be
    // counted somewhere; dropping it would break the reconciliation above.
    const cust = await prisma.customer.create({
      data: { companyId: COMPANY_ID, externalId: "orphan", name: "Orphan Debt", currentBalance: 2500, creditDays: 0 },
    });
    await prisma.invoice.create({
      data: {
        companyId: COMPANY_ID,
        externalId: "orphan-ob",
        customerId: cust.id,
        type: "OPENING_BALANCE",
        invoiceDate: daysAgo(300),
        dueDate: daysAgo(300),
        totalAmount: 2500,
        paidAmount: 0,
        balanceAmount: 2500,
      },
    });

    const { aging, summary } = await getOverdueCustomers(COMPANY_ID, 0);
    expect(aging.find((b) => b.label === "90+ din")!.amount).toBe(2500);
    expect(aging.reduce((s, b) => s + b.amount, 0)).toBeCloseTo(summary.totalOverdue, 2);
  });
});
