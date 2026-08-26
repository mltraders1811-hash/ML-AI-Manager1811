import Database from "better-sqlite3";

import {
  CUSTOMER_FIELD_CANDIDATES,
  INVENTORY_FIELD_CANDIDATES,
  LINE_ITEM_FIELD_CANDIDATES,
  PARTY_GROUP_FIELD_CANDIDATES,
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

function tryResolveTable(db: Database.Database, candidates: string[]): string | null {
  const tables = listTables(db);
  for (const c of candidates) {
    const found = tables.find((t) => t.toLowerCase() === c.toLowerCase());
    if (found) return found;
  }
  return null;
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

/** Verified: Vyapar stores dates as "YYYY-MM-DD HH:MM:SS" text (parses
 * correctly as UTC in Node). Also handles epoch numbers defensively in
 * case a different export version uses them. */
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

function readPartyGroups(db: Database.Database): Map<string, string> {
  const table = tryResolveTable(db, TABLE_CANDIDATES.partyGroups);
  if (!table) return new Map();
  const columns = listColumns(db, table);
  const idCol = resolveColumn(columns, PARTY_GROUP_FIELD_CANDIDATES.id, "id", table, false);
  const nameCol = resolveColumn(columns, PARTY_GROUP_FIELD_CANDIDATES.name, "name", table, false);
  if (!idCol || !nameCol) return new Map();

  const rows = db.prepare(`select * from "${table}"`).all() as Record<string, unknown>[];
  const map = new Map<string, string>();
  for (const r of rows) {
    const id = r[idCol];
    const name = toStringOrNull(r[nameCol]);
    if (id !== null && id !== undefined && name) map.set(String(id), name);
  }
  return map;
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
    groupId: resolveColumn(columns, CUSTOMER_FIELD_CANDIDATES.groupId, "groupId", table, false),
  };
  const partyGroups = readPartyGroups(db);

  const rows = db.prepare(`select * from "${table}"`).all() as Record<string, unknown>[];
  return rows
    .filter((r) => r[col.externalId] !== null && r[col.externalId] !== undefined)
    .map((r) => {
      const groupId = col.groupId ? r[col.groupId] : null;
      const partyGroupName =
        groupId !== null && groupId !== undefined ? (partyGroups.get(String(groupId)) ?? null) : null;
      return {
        externalId: String(r[col.externalId]),
        name: toStringOrNull(r[col.name]) ?? "Unknown",
        phone: col.phone ? toStringOrNull(r[col.phone]) : null,
        email: col.email ? toStringOrNull(r[col.email]) : null,
        address: col.address ? toStringOrNull(r[col.address]) : null,
        partyGroupName,
      };
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
    itemId: resolveColumn(columns, LINE_ITEM_FIELD_CANDIDATES.itemId, "itemId", table, false),
    quantity: resolveColumn(columns, LINE_ITEM_FIELD_CANDIDATES.quantity, "quantity", table, false),
    unitPrice: resolveColumn(columns, LINE_ITEM_FIELD_CANDIDATES.unitPrice, "unitPrice", table, false),
    amount: resolveColumn(columns, LINE_ITEM_FIELD_CANDIDATES.amount, "amount", table)!,
  };

  // Item names live in a separate table (kb_items), joined by item_id.
  const itemNames = new Map<string, string>();
  const itemsTable = tryResolveTable(db, TABLE_CANDIDATES.inventory);
  if (itemsTable) {
    const itemsColumns = listColumns(db, itemsTable);
    const itemIdCol = resolveColumn(itemsColumns, INVENTORY_FIELD_CANDIDATES.externalId, "id", itemsTable, false);
    const itemNameCol = resolveColumn(itemsColumns, INVENTORY_FIELD_CANDIDATES.name, "name", itemsTable, false);
    if (itemIdCol && itemNameCol) {
      const itemRows = db.prepare(`select "${itemIdCol}" as id, "${itemNameCol}" as name from "${itemsTable}"`).all() as {
        id: unknown;
        name: unknown;
      }[];
      for (const r of itemRows) {
        const name = toStringOrNull(r.name);
        if (r.id !== null && r.id !== undefined && name) itemNames.set(String(r.id), name);
      }
    }
  }

  const rows = db.prepare(`select * from "${table}"`).all() as Record<string, unknown>[];
  return rows
    .filter((r) => r[col.externalId] !== null && r[col.externalId] !== undefined)
    .map((r) => {
      const itemId = col.itemId ? r[col.itemId] : null;
      const itemName =
        (itemId !== null && itemId !== undefined ? itemNames.get(String(itemId)) : undefined) ?? "Unknown item";
      return {
        externalId: String(r[col.externalId]),
        invoiceExternalId: String(r[col.invoiceExternalId]),
        itemName,
        quantity: col.quantity ? toNumber(r[col.quantity]) : 0,
        unitPrice: col.unitPrice ? toNumber(r[col.unitPrice]) : 0,
        amount: toNumber(r[col.amount]),
      };
    });
}

/** Verified against a real backup: kb_transactions has no direct "total
 * amount" column - a transaction's total is the sum of its own line
 * items. `lineItemTotalsByInvoice` must be built from readLineItems()
 * output before calling this. Falls back to the transaction's cash amount
 * for line-item-less transactions (payments), which do carry a real
 * amount there. */
export function readTransactions(db: Database.Database, lineItemTotalsByInvoice: Map<string, number>): NormalizedInvoice[] {
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
    balanceAmount: resolveColumn(columns, TRANSACTION_FIELD_CANDIDATES.balanceAmount, "balanceAmount", table, false),
    cashAmount: resolveColumn(columns, TRANSACTION_FIELD_CANDIDATES.cashAmount, "cashAmount", table, false),
  };

  const rows = db.prepare(`select * from "${table}"`).all() as Record<string, unknown>[];
  return rows
    .filter((r) => r[col.externalId] !== null && r[col.externalId] !== undefined)
    .map((r) => {
      const externalId = String(r[col.externalId]);
      const cashAmount = col.cashAmount ? toNumber(r[col.cashAmount]) : 0;
      const lineItemTotal = lineItemTotalsByInvoice.get(externalId);
      const total = lineItemTotal && lineItemTotal > 0 ? lineItemTotal : cashAmount;
      // txn_balance_amount is what Vyapar itself considers still
      // outstanding on this transaction (already accounts for any linked
      // payments) - if we can't find it, assume unpaid rather than
      // silently assuming everything is settled.
      const balance = col.balanceAmount ? toNumber(r[col.balanceAmount]) : total;
      const rawType = toStringOrNull(r[col.typeCode])?.toLowerCase() ?? "";
      return {
        externalId,
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

export function readInventory(db: Database.Database): NormalizedInventoryItem[] {
  let table: string;
  try {
    table = resolveTable(db, TABLE_CANDIDATES.inventory, "inventory (kb_items)");
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
    const customers = readCustomers(db);
    const lineItems = readLineItems(db);

    const lineItemTotalsByInvoice = new Map<string, number>();
    for (const li of lineItems) {
      lineItemTotalsByInvoice.set(li.invoiceExternalId, (lineItemTotalsByInvoice.get(li.invoiceExternalId) ?? 0) + li.amount);
    }
    const invoices = readTransactions(db, lineItemTotalsByInvoice);

    return {
      customers,
      invoices,
      lineItems,
      inventoryItems: readInventory(db),
    };
  } finally {
    db.close();
  }
}
