// Parses a raw Vyapar/Vyapar-like "Sale Report" export (.xlsx) into
// broker-wise grouped transactions. Ported from khaata's
// backend/app/services/excel_parser.py (pandas/openpyxl) to TypeScript
// (exceljs) - same header-detection and column-matching approach so it's
// resilient to the exact same range of real-world export quirks.
import ExcelJS from "exceljs";

import { BROKERAGE_RATE, SHOP_OWN_NAME, normalizeBroker, orderBrokers } from "./brokerRules";
import type { BrokerGroup, BrokerageTransactionRow, ParsedSaleReport } from "./types";
import { ReportParseError } from "./types";

function cellToPrimitive(value: ExcelJS.CellValue): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return typeof value === "boolean" ? String(value) : value;
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join("");
    }
    if ("result" in value) return cellToPrimitive(value.result as ExcelJS.CellValue);
    if ("text" in value && typeof (value as { text?: unknown }).text === "string") {
      return (value as { text: string }).text;
    }
    if ("error" in value) return null;
  }
  return null;
}

function cellText(value: ExcelJS.CellValue): string {
  const v = cellToPrimitive(value);
  if (v === null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function isBlank(value: ExcelJS.CellValue): boolean {
  const v = cellToPrimitive(value);
  return v === null || (typeof v === "string" && v.trim() === "");
}

function cellNumber(value: ExcelJS.CellValue): number | null {
  const v = cellToPrimitive(value);
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parses "D/M/YYYY", "DD-MM-YY", etc. (day-first, matching pandas'
 * dayfirst=True) - returns {display, iso} or null if unparseable. */
function parseDayFirstDate(text: string): { display: string; iso: string } | null {
  const m = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  const day = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  let year = parseInt(m[3]!, 10);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null; // rolled over -> invalid date (e.g. 31/02)
  return { display: `${pad2(day)}/${pad2(month)}/${year}`, iso: `${year}-${pad2(month)}-${pad2(day)}` };
}

function dateFromCell(value: ExcelJS.CellValue): { display: string; iso: string | null } {
  const v = cellToPrimitive(value);
  if (v instanceof Date) {
    const day = v.getUTCDate();
    const month = v.getUTCMonth() + 1;
    const year = v.getUTCFullYear();
    return { display: `${pad2(day)}/${pad2(month)}/${year}`, iso: `${year}-${pad2(month)}-${pad2(day)}` };
  }
  const text = cellText(value);
  const parsed = parseDayFirstDate(text);
  if (parsed) return { display: parsed.display, iso: parsed.iso };
  return { display: text, iso: null };
}

function findHeaderColumn(headers: string[], ...candidates: string[]): number | null {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!.toLowerCase();
    for (const cand of candidates) {
      if (h.includes(cand)) return i;
    }
  }
  return null;
}

export async function parseSaleReport(fileBytes: Buffer): Promise<ParsedSaleReport> {
  const workbook = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs's
    // index.d.ts declares its own ambient `Buffer extends ArrayBuffer`,
    // which merges with (and is unsatisfiable alongside) @types/node's real
    // Buffer type. No cast through a concrete type can satisfy both at
    // once, so this is the one place `any` is the correct escape hatch.
    await workbook.xlsx.load(fileBytes as any);
  } catch (e) {
    throw new ReportParseError(`Could not read Excel file: ${(e as Error).message}`);
  }

  if (workbook.worksheets.length === 0) {
    throw new ReportParseError("The workbook has no sheets");
  }

  const sheet =
    workbook.worksheets.find((ws) => ws.name.toLowerCase().includes("item")) ?? workbook.worksheets[0]!;

  // Find the header row (contains both "Date" and something with "item name") in the first 15 rows.
  let headerRowNumber: number | null = null;
  let headers: string[] = [];
  const scanLimit = Math.min(15, sheet.rowCount);
  for (let r = 1; r <= scanLimit; r++) {
    const row = sheet.getRow(r);
    const values: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      values.push(cellText(row.getCell(c).value).toLowerCase());
    }
    if (values.includes("date") && values.some((v) => v.includes("item name"))) {
      headerRowNumber = r;
      headers = values;
      break;
    }
  }
  if (headerRowNumber === null) {
    throw new ReportParseError("Could not detect header row in Sale Items sheet");
  }

  const colDate = findHeaderColumn(headers, "date");
  const colParty = findHeaderColumn(headers, "party");
  const colItem = findHeaderColumn(headers, "item name");
  const colBro = findHeaderColumn(headers, "bro");
  const colQty = findHeaderColumn(headers, "quantity", "qty");
  const colPrice = findHeaderColumn(headers, "price/unit", "price");
  const colAmount = findHeaderColumn(headers, "amount");

  if ([colDate, colParty, colItem, colBro, colQty, colPrice, colAmount].some((c) => c === null)) {
    throw new ReportParseError("Required columns missing in Sale Items sheet");
  }
  const c = { date: colDate! + 1, party: colParty! + 1, item: colItem! + 1, bro: colBro! + 1, qty: colQty! + 1, price: colPrice! + 1, amount: colAmount! + 1 };

  const transactions: (BrokerageTransactionRow & { broker: string; isShopOwn: boolean })[] = [];
  let shopOwnCount = 0;

  for (let r = headerRowNumber + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const dateValue = row.getCell(c.date).value;
    const partyValue = row.getCell(c.party).value;
    if (isBlank(dateValue) && isBlank(partyValue)) continue;

    const qtyValue = row.getCell(c.qty).value;
    const priceValue = row.getCell(c.price).value;
    const amountValue = row.getCell(c.amount).value;
    const qty = cellNumber(qtyValue);
    const price = cellNumber(priceValue);
    const amount = cellNumber(amountValue);
    // Blank numeric cells default to 0 (matching the source); a cell that
    // has content but isn't numeric makes the whole row unusable - skip it
    // rather than silently recording a wrong amount.
    const qtyOk = isBlank(qtyValue) || qty !== null;
    const priceOk = isBlank(priceValue) || price !== null;
    const amountOk = isBlank(amountValue) || amount !== null;
    if (!qtyOk || !priceOk || !amountOk) continue;

    const { name: broker, isShopOwn } = normalizeBroker(cellText(row.getCell(c.bro).value) || null);
    const { display: dateStr, iso: dateIso } = dateFromCell(dateValue);
    const finalAmount = amount ?? 0;
    const brokerage = isShopOwn ? 0 : Math.round(finalAmount * BROKERAGE_RATE * 10_000) / 10_000;
    if (isShopOwn) shopOwnCount++;

    transactions.push({
      date: dateStr,
      dateIso,
      party: cellText(partyValue),
      item: cellText(row.getCell(c.item).value),
      quantity: qty ?? 0,
      price: price ?? 0,
      amount: finalAmount,
      brokerage,
      broker,
      isShopOwn,
    });
  }

  // Group by broker.
  const brokersByName: Record<string, BrokerGroup> = {};
  for (const t of transactions) {
    let group = brokersByName[t.broker];
    if (!group) {
      group = {
        name: t.broker,
        isShopOwn: t.isShopOwn,
        transactions: [],
        totalQty: 0,
        totalAmount: 0,
        totalBrokerage: 0,
        transactionCount: 0,
      };
      brokersByName[t.broker] = group;
    }
    group.transactions.push({
      date: t.date,
      dateIso: t.dateIso,
      party: t.party,
      item: t.item,
      quantity: t.quantity,
      price: t.price,
      amount: t.amount,
      brokerage: t.brokerage,
    });
    group.totalQty += t.quantity;
    group.totalAmount += t.amount;
    group.totalBrokerage += t.brokerage;
  }
  for (const group of Object.values(brokersByName)) {
    group.totalQty = round2(group.totalQty);
    group.totalAmount = round2(group.totalAmount);
    group.totalBrokerage = round2(group.totalBrokerage);
    group.transactionCount = group.transactions.length;
  }

  const brokerList = orderBrokers(brokersByName);

  const summary = {
    totalTransactions: transactions.length,
    totalAmount: round2(transactions.reduce((s, t) => s + t.amount, 0)),
    totalBrokerage: round2(transactions.reduce((s, t) => s + t.brokerage, 0)),
    brokerCount: brokerList.length,
    shopOwnCount,
  };

  // Detect report month: most common YYYY-MM among transaction dates.
  const monthCounts = new Map<string, number>();
  for (const t of transactions) {
    if (t.dateIso) {
      const ym = t.dateIso.slice(0, 7);
      monthCounts.set(ym, (monthCounts.get(ym) ?? 0) + 1);
    }
  }
  let month: string | null = null;
  let best = 0;
  for (const [ym, count] of monthCounts) {
    if (count > best) {
      best = count;
      month = ym;
    }
  }

  return { month, summary, brokers: brokerList };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export { SHOP_OWN_NAME };
