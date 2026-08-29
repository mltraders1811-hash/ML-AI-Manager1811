import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../src/lib/prisma";
import { BACKUP_FORMAT_VERSION, buildBackup } from "../src/lib/backup";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID!;

describe("backup", () => {
  let reportId: string;

  beforeAll(async () => {
    await prisma.company.upsert({
      where: { id: COMPANY_ID },
      update: {},
      create: { id: COMPANY_ID, name: "Test Co" },
    });
    await prisma.brokeragePayment.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.brokerageReport.deleteMany({ where: { companyId: COMPANY_ID } });
    // Invoices reference customers, so they have to go first.
    await prisma.invoiceLineItem.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.invoice.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.customer.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.overdueSettings.deleteMany({ where: { companyId: COMPANY_ID } });

    // A customer with hand-entered details, and one straight from Vyapar.
    await prisma.customer.create({
      data: {
        companyId: COMPANY_ID,
        externalId: "v-1",
        name: "Edited Party",
        phone: "9998887777",
        note: "pays late",
        creditDays: 40,
      },
    });
    await prisma.customer.create({
      data: { companyId: COMPANY_ID, externalId: "v-2", name: "Untouched Party" },
    });

    await prisma.overdueSettings.create({
      data: { companyId: COMPANY_ID, creditDays: 21, reminderTemplate: "Custom {party} wording" },
    });

    const report = await prisma.brokerageReport.create({
      data: {
        companyId: COMPANY_ID,
        filename: "sale-report.xlsx",
        fileSize: 1234,
        month: "2026-07",
        source: "UPLOAD",
        totalTransactions: 2,
        totalAmount: 5000,
        totalBrokerage: 25,
        brokerCount: 1,
        shopOwnCount: 0,
        brokers: {
          create: {
            companyId: COMPANY_ID,
            name: "Tota",
            totalQty: 10,
            totalAmount: 5000,
            totalBrokerage: 25,
            transactionCount: 2,
            transactions: {
              create: [
                {
                  companyId: COMPANY_ID,
                  date: "05/07/2026",
                  dateIso: "2026-07-05",
                  party: "Some Shop",
                  item: "Haldi",
                  quantity: 10,
                  price: 500,
                  amount: 5000,
                  brokerage: 25,
                },
              ],
            },
          },
        },
      },
    });
    reportId = report.id;

    await prisma.brokeragePayment.create({
      data: { companyId: COMPANY_ID, reportId, broker: "Tota", amount: 25, paidOn: "2026-08-01", note: "cash" },
    });
  });

  afterAll(async () => {
    await prisma.brokeragePayment.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.brokerageReport.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.invoiceLineItem.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.invoice.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.customer.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.overdueSettings.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.$disconnect();
  });

  it("captures brokerage payments, which exist nowhere else", async () => {
    const b = await buildBackup(COMPANY_ID);
    expect(b.brokeragePayments).toHaveLength(1);
    expect(JSON.stringify(b.brokeragePayments)).toContain("Tota");
  });

  it("captures an uploaded report with its brokers and transactions", async () => {
    const b = await buildBackup(COMPANY_ID);
    expect(b.brokerageReports).toHaveLength(1);
    const serialised = JSON.stringify(b.brokerageReports);
    expect(serialised).toContain("sale-report.xlsx");
    expect(serialised).toContain("Some Shop"); // the nested transaction survived
  });

  it("captures hand-entered customer details but skips untouched rows", async () => {
    // Untouched customers are rebuilt by the next sync, so carrying them
    // would just bloat the file.
    const b = await buildBackup(COMPANY_ID);
    expect(b.customerEdits).toHaveLength(1);
    expect(b.customerEdits[0]).toMatchObject({
      externalId: "v-1",
      phone: "9998887777",
      note: "pays late",
      creditDays: 40,
    });
  });

  it("keys customer edits by the Vyapar id so a restore can re-attach them", async () => {
    // Our own uuids are regenerated if the row is ever recreated; the Vyapar
    // id is the stable handle.
    const b = await buildBackup(COMPANY_ID);
    expect(b.customerEdits[0]!.externalId).toBe("v-1");
    expect(JSON.stringify(b.customerEdits[0])).not.toContain("-4"); // no uuid v4 leaked in
  });

  it("captures the reminder wording", async () => {
    const b = await buildBackup(COMPANY_ID);
    expect(b.overdueSettings).toMatchObject({ creditDays: 21, reminderTemplate: "Custom {party} wording" });
  });

  it("keeps money exact rather than as a float", async () => {
    // Prisma Decimal serialises as a string; a float round-trip could shift
    // a paise on large brokerage sums.
    const parsed = JSON.parse(JSON.stringify(await buildBackup(COMPANY_ID)));
    const payment = parsed.brokeragePayments[0];
    expect(typeof payment.amount).toBe("string");
    expect(payment.amount).toBe("25");
  });

  it("is stamped so a future restore knows what it is reading", async () => {
    const b = await buildBackup(COMPANY_ID);
    expect(b.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(b.companyId).toBe(COMPANY_ID);
    expect(Date.parse(b.exportedAt)).toBeGreaterThan(0);
    expect(b.counts).toMatchObject({ customerEdits: 1, brokerageReports: 1, brokeragePayments: 1 });
  });
});
