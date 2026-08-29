import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/lib/prisma";
import { getOverdueCustomers } from "../src/lib/overdue";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID!;

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** A party owing money on a bill old enough to be overdue. */
async function makeIndebtedCustomer(name: string, balance: number) {
  const customer = await prisma.customer.create({
    data: { companyId: COMPANY_ID, externalId: `ext-${name}`, name, currentBalance: balance },
  });
  await prisma.invoice.create({
    data: {
      companyId: COMPANY_ID,
      externalId: `inv-${name}`,
      customerId: customer.id,
      type: "SALE",
      invoiceDate: daysAgo(90),
      dueDate: daysAgo(65),
      totalAmount: balance,
      paidAmount: 0,
      balanceAmount: balance,
    },
  });
  return customer;
}

describe("reminder history", () => {
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

  it("marks a customer who has never been reminded", async () => {
    await makeIndebtedCustomer("Never Chased", 5000);
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    const c = customers.find((x) => x.party === "Never Chased")!;
    expect(c.lastReminderAt).toBeNull();
    expect(c.daysSinceReminder).toBeNull();
    expect(c.reminderCount).toBe(0);
    expect(c.paidSinceReminder).toBeNull();
  });

  it("reports how long ago the last reminder went out", async () => {
    const cust = await makeIndebtedCustomer("Chased", 5000);
    await prisma.reminderLog.create({
      data: {
        companyId: COMPANY_ID,
        customerId: cust.id,
        sentAt: daysAgo(3),
        balanceAtSend: 5000,
        overdueAtSend: 5000,
        daysOverdueAtSend: 62,
      },
    });
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    const c = customers.find((x) => x.party === "Chased")!;
    expect(c.daysSinceReminder).toBe(3);
    expect(c.reminderCount).toBe(1);
  });

  it("shows that a reminder worked when the balance has come down since", async () => {
    // Owed 8000 when chased, owes 3000 now - 5000 came in after the nudge.
    const cust = await makeIndebtedCustomer("Paid Up", 3000);
    await prisma.reminderLog.create({
      data: {
        companyId: COMPANY_ID,
        customerId: cust.id,
        sentAt: daysAgo(5),
        balanceAtSend: 8000,
        overdueAtSend: 8000,
        daysOverdueAtSend: 60,
      },
    });
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    const c = customers.find((x) => x.party === "Paid Up")!;
    expect(c.paidSinceReminder).toBe(5000);
  });

  it("shows nothing paid when the balance has not moved", async () => {
    const cust = await makeIndebtedCustomer("Ignored", 5000);
    await prisma.reminderLog.create({
      data: {
        companyId: COMPANY_ID,
        customerId: cust.id,
        sentAt: daysAgo(10),
        balanceAtSend: 5000,
        overdueAtSend: 5000,
        daysOverdueAtSend: 55,
      },
    });
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    expect(customers.find((x) => x.party === "Ignored")!.paidSinceReminder).toBe(0);
  });

  it("goes negative when they bought more on credit instead of paying", async () => {
    // Worth distinguishing from "ignored the reminder" - the debt grew.
    const cust = await makeIndebtedCustomer("Bought More", 9000);
    await prisma.reminderLog.create({
      data: {
        companyId: COMPANY_ID,
        customerId: cust.id,
        sentAt: daysAgo(4),
        balanceAtSend: 6000,
        overdueAtSend: 6000,
        daysOverdueAtSend: 61,
      },
    });
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    expect(customers.find((x) => x.party === "Bought More")!.paidSinceReminder).toBe(-3000);
  });

  it("counts repeat reminders and reports only the most recent", async () => {
    const cust = await makeIndebtedCustomer("Thrice", 5000);
    for (const n of [20, 10, 2]) {
      await prisma.reminderLog.create({
        data: {
          companyId: COMPANY_ID,
          customerId: cust.id,
          sentAt: daysAgo(n),
          balanceAtSend: 5000,
          overdueAtSend: 5000,
          daysOverdueAtSend: 50,
        },
      });
    }
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    const c = customers.find((x) => x.party === "Thrice")!;
    expect(c.reminderCount).toBe(3);
    expect(c.daysSinceReminder).toBe(2); // the latest, not the first
  });

  it("keeps each customer's history separate", async () => {
    const a = await makeIndebtedCustomer("Party A", 5000);
    await makeIndebtedCustomer("Party B", 5000);
    await prisma.reminderLog.create({
      data: {
        companyId: COMPANY_ID,
        customerId: a.id,
        sentAt: daysAgo(1),
        balanceAtSend: 5000,
        overdueAtSend: 5000,
        daysOverdueAtSend: 60,
      },
    });
    const { customers } = await getOverdueCustomers(COMPANY_ID);
    expect(customers.find((x) => x.party === "Party A")!.reminderCount).toBe(1);
    expect(customers.find((x) => x.party === "Party B")!.reminderCount).toBe(0);
  });

  it("removes a customer's reminders along with the customer", async () => {
    const cust = await makeIndebtedCustomer("Doomed", 5000);
    await prisma.reminderLog.create({
      data: {
        companyId: COMPANY_ID,
        customerId: cust.id,
        sentAt: new Date(),
        balanceAtSend: 5000,
        overdueAtSend: 5000,
        daysOverdueAtSend: 60,
      },
    });
    await prisma.invoice.deleteMany({ where: { customerId: cust.id } });
    await prisma.customer.delete({ where: { id: cust.id } });
    expect(await prisma.reminderLog.count({ where: { customerId: cust.id } })).toBe(0);
  });
});
