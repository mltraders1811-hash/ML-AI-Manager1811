import { getDb } from "./index";
import { nowISO } from "../lib/id";

/** Everything in the database, in one JSON file. A shop changing phones has
 *  no server to restore from, so this file is the only copy of its book. */
export interface Backup {
  app: "ml-orders";
  version: 1;
  exportedAt: string;
  parties: unknown[];
  items: unknown[];
  brokers: unknown[];
  orders: unknown[];
  orderLines: unknown[];
  settings: unknown[];
}

export async function exportBackup(): Promise<Backup> {
  const db = await getDb();
  const [parties, items, brokers, orders, orderLines, settings] =
    await Promise.all([
      db.getAllAsync("SELECT * FROM parties"),
      db.getAllAsync("SELECT * FROM items"),
      db.getAllAsync("SELECT * FROM brokers"),
      db.getAllAsync("SELECT * FROM orders"),
      db.getAllAsync("SELECT * FROM order_lines"),
      db.getAllAsync("SELECT * FROM settings"),
    ]);
  return {
    app: "ml-orders",
    version: 1,
    exportedAt: nowISO(),
    parties,
    items,
    brokers,
    orders,
    orderLines,
    settings,
  };
}

export interface RestoreResult {
  orders: number;
  parties: number;
  items: number;
}

/** Replaces the whole database with the file's contents. Destructive by
 *  design - a merge would have to guess what to do with two versions of the
 *  same bill, and guessing about money is worse than asking. */
export async function restoreBackup(raw: string): Promise<RestoreResult> {
  const parsed: unknown = JSON.parse(raw);
  if (!isBackup(parsed)) {
    throw new Error("This file is not an M.L Orders backup.");
  }
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      DELETE FROM order_lines;
      DELETE FROM orders;
      DELETE FROM parties;
      DELETE FROM items;
      DELETE FROM brokers;
      DELETE FROM settings;
    `);
    await insertAll(db, "parties", parsed.parties);
    await insertAll(db, "items", parsed.items);
    await insertAll(db, "brokers", parsed.brokers);
    await insertAll(db, "orders", parsed.orders);
    await insertAll(db, "order_lines", parsed.orderLines);
    await insertAll(db, "settings", parsed.settings);
  });

  return {
    orders: parsed.orders.length,
    parties: parsed.parties.length,
    items: parsed.items.length,
  };
}

async function insertAll(
  db: Awaited<ReturnType<typeof getDb>>,
  table: string,
  rows: unknown[],
): Promise<void> {
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entries = Object.entries(row as Record<string, unknown>);
    if (entries.length === 0) continue;
    // Column names come from a file, so they are quoted as identifiers and
    // every value is bound - never concatenated into the statement.
    const columns = entries.map(([k]) => `"${k.replace(/"/g, '""')}"`).join(", ");
    const placeholders = entries.map(() => "?").join(", ");
    const values = entries.map(([, v]) =>
      v === null || typeof v === "number" || typeof v === "string" ? v : String(v),
    );
    await db.runAsync(
      `INSERT OR REPLACE INTO ${table} (${columns}) VALUES (${placeholders})`,
      values as (string | number | null)[],
    );
  }
}

function isBackup(value: unknown): value is Backup {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<Backup>;
  return (
    b.app === "ml-orders" &&
    Array.isArray(b.parties) &&
    Array.isArray(b.items) &&
    Array.isArray(b.brokers) &&
    Array.isArray(b.orders) &&
    Array.isArray(b.orderLines) &&
    Array.isArray(b.settings)
  );
}
