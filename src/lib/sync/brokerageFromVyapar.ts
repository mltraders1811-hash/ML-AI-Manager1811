// Derives broker-wise sale groupings directly from a Vyapar backup instead
// of a manually-uploaded Sale Report Excel. Verified against a real
// backup: brokers are tracked as Vyapar "party groups" that customers are
// assigned to (e.g. a group named "Tota Brokar" or "Rajesh") - every SALE
// line item from a customer in one of those groups is that broker's sale.
// Party groups that don't match a known broker (geographic groups like
// "MAUGANJ", or functional ones like "General") are NOT treated as a
// broker - those sales count as Shop Own Sale, same as an ungrouped
// customer.
import { BROKERAGE_RATE, BROKER_MAP, SHOP_OWN_NAME, orderBrokers } from "@/lib/brokerage/brokerRules";
import type { BrokerGroup, BrokerageTransactionRow, ParsedSaleReport } from "@/lib/brokerage/types";

import type { NormalizedCustomer, NormalizedInvoice, VyaparExtract } from "./types";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Unlike normalizeBroker() (used for the Excel "Bro." column, where every
 * value is deliberately entered as a broker), a Vyapar party group is used
 * for many unrelated things - only a name that actually maps to a known
 * broker counts; anything else is Shop Own Sale rather than a fabricated
 * "broker" named after a town or category. */
function matchBrokerFromGroupName(groupName: string | null): { name: string; isShopOwn: boolean } {
  if (!groupName) return { name: SHOP_OWN_NAME, isShopOwn: true };
  const stripped = groupName.replace(/\bbrokar\b|\bbroker\b/gi, "").trim();
  const key = stripped.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  const mapped = BROKER_MAP[key];
  if (mapped) return { name: mapped, isShopOwn: false };
  return { name: SHOP_OWN_NAME, isShopOwn: true };
}

type AttributedRow = { row: BrokerageTransactionRow; broker: string; isShopOwn: boolean; month: string | null };

function buildReport(rows: AttributedRow[]): ParsedSaleReport {
  const brokersByName: Record<string, BrokerGroup> = {};
  let shopOwnCount = 0;
  for (const t of rows) {
    let group = brokersByName[t.broker];
    if (!group) {
      group = { name: t.broker, isShopOwn: t.isShopOwn, transactions: [], totalQty: 0, totalAmount: 0, totalBrokerage: 0, transactionCount: 0 };
      brokersByName[t.broker] = group;
    }
    group.transactions.push(t.row);
    group.totalQty += t.row.quantity;
    group.totalAmount += t.row.amount;
    group.totalBrokerage += t.row.brokerage;
    if (t.isShopOwn) shopOwnCount++;
  }
  for (const group of Object.values(brokersByName)) {
    group.totalQty = round2(group.totalQty);
    group.totalAmount = round2(group.totalAmount);
    group.totalBrokerage = round2(group.totalBrokerage);
    group.transactionCount = group.transactions.length;
  }
  const brokerList = orderBrokers(brokersByName);

  const monthCounts = new Map<string, number>();
  for (const t of rows) {
    if (t.row.dateIso) monthCounts.set(t.row.dateIso.slice(0, 7), (monthCounts.get(t.row.dateIso.slice(0, 7)) ?? 0) + 1);
  }
  let month: string | null = null;
  let best = 0;
  for (const [ym, count] of monthCounts) {
    if (count > best) {
      best = count;
      month = ym;
    }
  }

  return {
    month,
    summary: {
      totalTransactions: rows.length,
      totalAmount: round2(rows.reduce((s, t) => s + t.row.amount, 0)),
      totalBrokerage: round2(rows.reduce((s, t) => s + t.row.brokerage, 0)),
      brokerCount: brokerList.length,
      shopOwnCount,
    },
    brokers: brokerList,
  };
}

/** One ParsedSaleReport per calendar month found in the extract's SALE
 * line items, keyed by "YYYY-MM". Caller decides which months to persist
 * (see runDerivedBrokerageSync in syncEngine.ts - only recent months are
 * re-derived on every daily sync to avoid reprocessing years of settled
 * history). */
export function deriveBrokerageByMonth(extract: VyaparExtract): Map<string, ParsedSaleReport> {
  const customerById = new Map<string, NormalizedCustomer>(extract.customers.map((c) => [c.externalId, c]));
  const invoiceById = new Map<string, NormalizedInvoice>(extract.invoices.map((i) => [i.externalId, i]));

  const rowsByMonth = new Map<string, AttributedRow[]>();

  for (const li of extract.lineItems) {
    const invoice = invoiceById.get(li.invoiceExternalId);
    if (!invoice || invoice.type !== "SALE") continue;

    const day = invoice.invoiceDate.getUTCDate();
    const monthNum = invoice.invoiceDate.getUTCMonth() + 1;
    const year = invoice.invoiceDate.getUTCFullYear();
    const dateIso = `${year}-${pad2(monthNum)}-${pad2(day)}`;
    const ym = dateIso.slice(0, 7);

    const customer = customerById.get(invoice.customerExternalId);
    const { name: broker, isShopOwn } = matchBrokerFromGroupName(customer?.partyGroupName ?? null);
    const brokerage = isShopOwn ? 0 : round2(li.amount * BROKERAGE_RATE);

    const row: BrokerageTransactionRow = {
      date: `${pad2(day)}/${pad2(monthNum)}/${year}`,
      dateIso,
      party: customer?.name ?? "Unknown",
      item: li.itemName,
      quantity: li.quantity,
      price: li.unitPrice,
      amount: li.amount,
      brokerage,
    };

    const list = rowsByMonth.get(ym) ?? [];
    list.push({ row, broker, isShopOwn, month: ym });
    rowsByMonth.set(ym, list);
  }

  const reportsByMonth = new Map<string, ParsedSaleReport>();
  for (const [ym, rows] of rowsByMonth) {
    reportsByMonth.set(ym, buildReport(rows));
  }
  return reportsByMonth;
}
