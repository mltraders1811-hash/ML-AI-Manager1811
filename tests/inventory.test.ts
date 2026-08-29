import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/lib/prisma";
import { getSoldItems, listItems } from "../src/lib/inventory";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID!;

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function addItem(name: string, sale: number | null, cost: number | null) {
  return prisma.inventoryItem.create({
    data: { companyId: COMPANY_ID, externalId: `i-${name}`, name, salePrice: sale, purchasePrice: cost },
  });
}

async function addSale(id: string, itemName: string, qty: number, unitPrice: number, age: number) {
  const customer = await prisma.customer.upsert({
    where: { companyId_externalId: { companyId: COMPANY_ID, externalId: "buyer" } },
    update: {},
    create: { companyId: COMPANY_ID, externalId: "buyer", name: "Buyer" },
  });
  const invoice = await prisma.invoice.create({
    data: {
      companyId: COMPANY_ID,
      externalId: `sale-${id}`,
      customerId: customer.id,
      type: "SALE",
      invoiceDate: daysAgo(age),
      totalAmount: qty * unitPrice,
      paidAmount: 0,
      balanceAmount: qty * unitPrice,
    },
  });
  await prisma.invoiceLineItem.create({
    data: {
      companyId: COMPANY_ID,
      externalId: `line-${id}`,
      invoiceId: invoice.id,
      itemName,
      quantity: qty,
      unitPrice,
      amount: qty * unitPrice,
    },
  });
}

describe("what sold", () => {
  beforeEach(async () => {
    await prisma.company.upsert({
      where: { id: COMPANY_ID },
      update: {},
      create: { id: COMPANY_ID, name: "Test Co" },
    });
    await prisma.invoiceLineItem.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.invoice.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.customer.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.inventoryItem.deleteMany({ where: { companyId: COMPANY_ID } });
  });

  afterAll(async () => {
    await prisma.invoiceLineItem.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.invoice.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.customer.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.inventoryItem.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.$disconnect();
  });

  it("totals quantity and revenue per item from the invoice lines", async () => {
    await addSale("s1", "Haldi", 10, 120, 3);
    await addSale("s2", "Haldi", 5, 120, 2);
    const { items } = await getSoldItems(COMPANY_ID, 30);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 15, revenue: 1800, saleCount: 2 });
  });

  it("reports the rate actually achieved, not the list rate", async () => {
    // Discounting is the thing worth seeing; a list price would hide it.
    await addItem("Haldi", 125, null);
    await addSale("s1", "Haldi", 10, 110, 3);
    const { items } = await getSoldItems(COMPANY_ID, 30);
    expect(items[0]!.averageRate).toBe(110);
    expect(items[0]!.listRate).toBe(125);
  });

  it("averages the rate across sales at different prices", async () => {
    await addSale("s1", "Haldi", 10, 100, 3); // 1000
    await addSale("s2", "Haldi", 10, 140, 2); // 1400
    const { items } = await getSoldItems(COMPANY_ID, 30);
    expect(items[0]!.revenue).toBe(2400);
    expect(items[0]!.averageRate).toBe(120);
  });

  it("leaves the list rate blank for something not in the item master", async () => {
    await addSale("s1", "Mystery Goods", 2, 500, 4);
    const { items } = await getSoldItems(COMPANY_ID, 30);
    expect(items[0]!.listRate).toBeNull();
    expect(items[0]!.revenue).toBe(1000); // revenue is still known
  });

  it("honours the date window", async () => {
    await addSale("recent", "Haldi", 1, 120, 3);
    await addSale("old", "Haldi", 1, 120, 60);
    expect((await getSoldItems(COMPANY_ID, 7)).items[0]!.quantity).toBe(1);
    expect((await getSoldItems(COMPANY_ID, 90)).items[0]!.quantity).toBe(2);
  });

  it("ranks by revenue, not quantity", async () => {
    await addSale("cheap", "Cheap Bulk", 1000, 2, 3); // 2000
    await addSale("dear", "Dear Item", 2, 5000, 3); // 10000
    const { items } = await getSoldItems(COMPANY_ID, 30);
    expect(items.map((i) => i.itemName)).toEqual(["Dear Item", "Cheap Bulk"]);
  });

  it("returns empty totals rather than failing when nothing sold", async () => {
    const { items, totals } = await getSoldItems(COMPANY_ID, 30);
    expect(items).toEqual([]);
    expect(totals).toMatchObject({ revenue: 0, itemCount: 0, lineCount: 0 });
  });
});

describe("item list", () => {
  beforeEach(async () => {
    await prisma.company.upsert({
      where: { id: COMPANY_ID },
      update: {},
      create: { id: COMPANY_ID, name: "Test Co" },
    });
    await prisma.inventoryItem.deleteMany({ where: { companyId: COMPANY_ID } });
  });

  it("counts how many items carry a buying rate", async () => {
    // This drives the note explaining why margins aren't reported - in the
    // real book only 71 of 397 sold items have one.
    await addItem("Priced", 120, 100);
    await addItem("No Cost A", 120, null);
    await addItem("No Cost B", 120, null);
    const { summary } = await listItems(COMPANY_ID);
    expect(summary).toMatchObject({ itemCount: 3, withPurchaseRate: 1 });
  });

  it("treats a zero buying rate as not recorded", async () => {
    // Vyapar stores an unentered cost as 0, and a free item is not a thing
    // here - counting it would overstate how costable the book is.
    await addItem("Zero Cost", 120, 0);
    const { summary } = await listItems(COMPANY_ID);
    expect(summary.withPurchaseRate).toBe(0);
  });

  it("searches by name", async () => {
    await addItem("Haldi Powder", 10, 5);
    await addItem("Mirchi Whole", 10, 5);
    const { items } = await listItems(COMPANY_ID, "mirchi");
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Mirchi Whole");
  });
});
