import Database from "better-sqlite3";

import {
  CUSTOMER_FIELD_CANDIDATES,
  INVENTORY_FIELD_CANDIDATES,
  LINE_ITEM_FIELD_CANDIDATES,
  TABLE_CANDIDATES,
  TRANSACTION_FIELD_CANDIDATES,
  TXN_TYPE_MAP,
} from "./columnMap";
import type {
  NormalizedCustomer,
  NormalizedInventoryItem,
  NormalizedInvoice,
  NormalizedLineItem,
  VyaparExtract,
} from "./types";

export class SchemaResolutionError extends Error {}

function listTables(db: Database.Database): string[] {
  const rows = db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[];
  return rows.map((r) => r.name);
}

function resolveTable(db: Database.Database, candidates: string[], logicalName: string): string {
  const tables = listTables(db);
  for (const c of candidates) {
    const found = tables.find((t) => t.toLowerCase() === c.toLowerCase());
    if (found) return found;
  }
  throw new SchemaResolutionError(
    `Could not find a table for "${logicalName}" (tried: ${candidates.join(", ")}). ` +
      `Tables present in this .vyp file: ${tables.join(", ")}. ` +
      `Run "npm run inspect-vyp -- <file.vyp>" and update src/lib/sync/columnMap.ts.`,
  );
}

function listColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`pragma table_info("${table}")`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

function resolveColumn(
  columns: string[],
  candidates: string[],
  field: string,
  table: string,
  required = true,
): string | null {
  for (const c of candidates) {
    const found = columns.find((col) => col.toLowerCase() === c.toLowerCase());
    if (found) return found;
  }
  for (const c of candidates) {
    const found = columns.find((col) => col.toLowerCase().includes(c.toLowerCase()));
    if (found) return found;
  }
  if (required) {
    throw new SchemaResolutionError(
      `Could not resolve column for "${field}" in table "${table}" (tried: ${candidates.join(", ")}). ` +
        `Columns present: ${columns.join(", ")}. ` +
        `Update the candidates in src/lib/sync/columnMap.ts.`,
    );
  }
  return null;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Vyapar stores dates as epoch millis, epoch seconds, or "YYYY-MM-DD" text
 * depending on version - handle whichever shows up. */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    // Heuristic: 10-digit numbers are epoch seconds, 13-digit are epoch millis.
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

export function readCustomers(db: Database.Database): NormalizedCustomer[] {
  const table = resolveTable(db, TABLE_CANDIDATES.customers, "customers (kb_names)");
  const columns = listColumns(db, table);
  const col = {
    externalId: resolveColumn(columns, CUSTOMER_FIELD_CANDIDATES.externalId, "externalId", table)!,
    name: resolveColumn(columns, CUSTOMER_FIELD_CANDIDATES.name, "name", table)!,
    phone: resolveColumn(columns, CUSTOMER_FIELD_CANDIDATES.phone, "phone", table, false),
    email: resolveColumn(columns, CUSTOMER_FIELD_CANDIDATES.email, "email", table, false),
    address: resolveColumn(columns, CUSTOMER_FIELD_CANDIDATES.address, "address", table, false),
  };

  const rows = db.prepare(`select * from "${table}"`).all() as Record<string, unknown>[];
  return rows
    .filter((r) => r[col.externalId] !== null && r[col.externalId] !== undefined)
    .map((r) => ({
      externalId: String(r[col.externalId]),
      name: toStringOrNull(r[col.name]) ?? "Unknown",
      phone: col.phone ? toStringOrNull(r[col.phone]) : null,
      email: col.email ? toStringOrNull(r[col.email]) : null,
      address: col.address ? toStringOrNull(r[col.address]) : null,
    }));
}

export function readTransactions(db: Database.Database): NormalizedInvoice[] {
  const table = resolveTable(db, TABLE_CANDIDATES.transactions, "transactions (kb_transactions)");
  const columns = listColumns(db, table);
  const col = {
    externalId: resolveColumn(columns, TRANSACTION_FIELD_CANDIDATES.externalId, "externalId", table)!,
    customerExternalId: resolveColumn(
      columns,
      TRANSACTION_FIELD_CANDIDATES.customerExternalId,
      "customerExternalId",
      table,
    )!,
    typeCode: resolveColumn(columns, TRANSACTION_FIELD_CANDIDATES.typeCode, "typeCode", table)!,
    invoiceNumber: resolveColumn(columns, TRANSACTION_FIELD_CANDIDATES.invoiceNumber, "invoiceNumber", table, false),
    invoiceDate: resolveColumn(columns, TRANSACTION_FIELD_CANDIDATES.invoiceDate, "invoiceDate", table)!,
    dueDate: resolveColumn(columns, TRANSACTION_FIELD_CANDIDATES.dueDate, "dueDate", table, false),
    totalAmount: resolveColumn(columns, TRANSACTION_FIELD_CANDIDATES.totalAmount, "totalAmount", table)!,
    balanceAmount: resolveColumn(columns, TRANSACTION_FIELD_CANDIDATES.balanceAmount, "balanceAmount", table, false),
  };

  const rows = db.prepare(`select * from "${table}"`).all() as Record<string, unknown>[];
  return rows
    .filter((r) => r[col.externalId] !== null && r[col.externalId] !== undefined)
    .map((r) => {
      const total = toNumber(r[col.totalAmount]);
      // Some Vyapar versions store remaining balance directly; others only
      // ever store the full amount (fully-paid-or-not tracked elsewhere).
      // If we can't find a balance column, assume unpaid (safer for a
      // collections tool than silently assuming everything is settled).
      const balance = col.balanceAmount ? toNumber(r[col.balanceAmount]) : total;
      const rawType = toStringOrNull(r[col.typeCode])?.toLowerCase() ?? "";
      return {
        externalId: String(r[col.externalId]),
        customerExternalId: String(r[col.customerExternalId]),
        type: TXN_TYPE_MAP[rawType] ?? "OTHER",
        invoiceNumber: col.invoiceNumber ? toStringOrNull(r[col.invoiceNumber]) : null,
        invoiceDate: toDate(r[col.invoiceDate]) ?? new Date(),
        dueDate: col.dueDate ? toDate(r[col.dueDate]) : null,
        totalAmount: total,
        paidAmount: Math.max(0, total - balance),
      } satisfies NormalizedInvoice;
    });
}

export function readLineItems(db: Database.Database): NormalizedLineItem[] {
  const table = resolveTable(db, TABLE_CANDIDATES.lineItems, "line items (kb_lineitems)");
  const columns = listColumns(db, table);
  const col = {
    externalId: resolveColumn(columns, LINE_ITEM_FIELD_CANDIDATES.externalId, "externalId", table)!,
    invoiceExternalId: resolveColumn(
      columns,
      LINE_ITEM_FIELD_CANDIDATES.invoiceExternalId,
      "invoiceExternalId",
      table,
    )!,
    itemName: resolveColumn(columns, LINE_ITEM_FIELD_CANDIDATES.itemName, "itemName", table)!,
    quantity: resolveColumn(columns, LINE_ITEM_FIELD_CANDIDATES.quantity, "quantity", table, false),
    unitPrice: resolveColumn(columns, LINE_ITEM_FIELD_CANDIDATES.unitPrice, "unitPrice", table, false),
    amount: resolveColumn(columns, LINE_ITEM_FIELD_CANDIDATES.amount, "amount", table)!,
  };

  const rows = db.prepare(`select * from "${table}"`).all() as Record<string, unknown>[];
  return rows
    .filter((r) => r[col.externalId] !== null && r[col.externalId] !== undefined)
    .map((r) => ({
      externalId: String(r[col.externalId]),
      invoiceExternalId: String(r[col.invoiceExternalId]),
      itemName: toStringOrNull(r[col.itemName]) ?? "Unknown item",
      quantity: col.quantity ? toNumber(r[col.quantity]) : 0,
      unitPrice: col.unitPrice ? toNumber(r[col.unitPrice]) : 0,
      amount: toNumber(r[col.amount]),
    }));
}

export function readInventory(db: Database.Database): NormalizedInventoryItem[] {
  let table: string;
  try {
    table = resolveTable(db, TABLE_CANDIDATES.inventory, "inventory (kb_item)");
  } catch (e) {
    if (e instanceof SchemaResolutionError) return []; // inventory sync is best-effort for V1
    throw e;
  }
  const columns = listColumns(db, table);
  const col = {
    externalId: resolveColumn(columns, INVENTORY_FIELD_CANDIDATES.externalId, "externalId", table)!,
    name: resolveColumn(columns, INVENTORY_FIELD_CANDIDATES.name, "name", table)!,
    currentStock: resolveColumn(columns, INVENTORY_FIELD_CANDIDATES.currentStock, "currentStock", table, false),
    salePrice: resolveColumn(columns, INVENTORY_FIELD_CANDIDATES.salePrice, "salePrice", table, false),
    purchasePrice: resolveColumn(
      columns,
      INVENTORY_FIELD_CANDIDATES.purchasePrice,
      "purchasePrice",
      table,
      false,
    ),
  };

  const rows = db.prepare(`select * from "${table}"`).all() as Record<string, unknown>[];
  return rows
    .filter((r) => r[col.externalId] !== null && r[col.externalId] !== undefined)
    .map((r) => ({
      externalId: String(r[col.externalId]),
      name: toStringOrNull(r[col.name]) ?? "Unknown item",
      currentStock: col.currentStock ? toNullableNumber(r[col.currentStock]) : null,
      salePrice: col.salePrice ? toNullableNumber(r[col.salePrice]) : null,
      purchasePrice: col.purchasePrice ? toNullableNumber(r[col.purchasePrice]) : null,
    }));
}

export function readVyaparExtract(vypFilePath: string): VyaparExtract {
  const db = new Database(vypFilePath, { readonly: true, fileMustExist: true });
  try {
    return {
      customers: readCustomers(db),
      invoices: readTransactions(db),
      lineItems: readLineItems(db),
      inventoryItems: readInventory(db),
    };
  } finally {
    db.close();
  }
}
