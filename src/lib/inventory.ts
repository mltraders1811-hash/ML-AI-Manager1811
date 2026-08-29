import { prisma } from "@/lib/prisma";
import { getIstTodayRange } from "@/lib/dateIst";

// A note on what this deliberately does NOT report, checked against the real
// backup rather than assumed:
//
//   * Profit margins. Only 71 of the 397 items actually sold carry a
//     purchase rate in Vyapar - the shop enters sales but rarely buying
//     rates. Costing 18% of the book and calling the result a margin would
//     produce a confident, wrong number (a first pass showed an 82.9%
//     margin on a grain wholesale business, because a missing cost reads as
//     zero). Better to omit it than to publish it.
//   * Stock on hand. item_stock_quantity is negative for 1,705 of 2,110
//     items, down to -15 lakh, for the same reason: goods go out without
//     purchases going in, so Vyapar's running count is not a stock figure.
//
// What IS reliable is what actually left the shop: every sale line carries a
// real quantity and a real price, because it came off an invoice. That's
// what this reports.

export type SoldItemRow = {
  itemName: string;
  quantity: number;
  revenue: number;
  saleCount: number;
  /** Revenue divided by quantity - the rate actually achieved, which shows
   * discounting that a list price would hide. */
  averageRate: number;
  /** The item's list rate in Vyapar, when it has one, for comparison. */
  listRate: number | null;
};

export type SoldItemsResult = {
  items: SoldItemRow[];
  totals: { revenue: number; itemCount: number; lineCount: number };
  fromDate: string;
  days: number;
};

/** What actually sold over a window, by item, newest data straight from the
 * invoice lines. */
export async function getSoldItems(companyId: string, days = 30): Promise<SoldItemsResult> {
  const { todayStart } = getIstTodayRange();
  const from = new Date(todayStart);
  from.setUTCDate(from.getUTCDate() - days);

  const [lines, items] = await Promise.all([
    prisma.invoiceLineItem.findMany({
      where: { companyId, invoice: { type: "SALE", invoiceDate: { gte: from } } },
      select: { itemName: true, quantity: true, amount: true },
    }),
    prisma.inventoryItem.findMany({
      where: { companyId, salePrice: { not: null } },
      select: { name: true, salePrice: true },
    }),
  ]);

  const listRateByName = new Map<string, number>();
  for (const i of items) listRateByName.set(i.name.toLowerCase(), i.salePrice!.toNumber());

  const byItem = new Map<string, { itemName: string; quantity: number; revenue: number; saleCount: number }>();
  for (const l of lines) {
    const key = l.itemName.toLowerCase();
    const row = byItem.get(key) ?? { itemName: l.itemName, quantity: 0, revenue: 0, saleCount: 0 };
    row.quantity += l.quantity.toNumber();
    row.revenue += l.amount.toNumber();
    row.saleCount += 1;
    byItem.set(key, row);
  }

  const rows: SoldItemRow[] = [...byItem.entries()].map(([key, r]) => {
    const quantity = Math.round(r.quantity * 1000) / 1000;
    const revenue = Math.round(r.revenue * 100) / 100;
    return {
      itemName: r.itemName,
      quantity,
      revenue,
      saleCount: r.saleCount,
      averageRate: quantity > 0 ? Math.round((revenue / quantity) * 100) / 100 : 0,
      listRate: listRateByName.get(key) ?? null,
    };
  });
  rows.sort((a, b) => b.revenue - a.revenue);

  return {
    items: rows,
    totals: {
      revenue: Math.round(rows.reduce((s, r) => s + r.revenue, 0) * 100) / 100,
      itemCount: rows.length,
      lineCount: lines.length,
    },
    fromDate: from.toISOString().slice(0, 10),
    days,
  };
}

export type ItemRow = {
  id: string;
  name: string;
  salePrice: number | null;
  purchasePrice: number | null;
};

export type ItemListResult = {
  items: ItemRow[];
  summary: {
    itemCount: number;
    /** How many carry a buying rate. Surfaced because it's the reason
     * margins aren't reported, and it's fixable in Vyapar. */
    withPurchaseRate: number;
  };
};

/** The item master: names and rates as Vyapar holds them. */
export async function listItems(companyId: string, query?: string): Promise<ItemListResult> {
  const q = (query ?? "").trim();
  const items = await prisma.inventoryItem.findMany({
    where: { companyId, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, salePrice: true, purchasePrice: true },
    take: 2000,
  });

  const rows = items.map((i) => ({
    id: i.id,
    name: i.name,
    salePrice: i.salePrice?.toNumber() ?? null,
    purchasePrice: i.purchasePrice?.toNumber() ?? null,
  }));

  return {
    items: rows,
    summary: {
      itemCount: rows.length,
      withPurchaseRate: rows.filter((r) => r.purchasePrice !== null && r.purchasePrice > 0).length,
    },
  };
}
