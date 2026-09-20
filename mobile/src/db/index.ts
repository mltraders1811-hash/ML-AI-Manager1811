import * as SQLite from "expo-sqlite";

import { MIGRATIONS } from "./schema";
import { seedCatalogue } from "./seed";

export const DB_NAME = "mlorders.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** One connection for the whole app, opened lazily and migrated once. Every
 *  screen awaits this same promise, so two screens mounting together cannot
 *  race two migrations against each other. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // WAL keeps a write from blocking the list that is being scrolled;
  // foreign_keys is off by default in SQLite and is what makes the
  // ON DELETE CASCADE on order_lines actually fire.
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  await migrate(db);
  await seedCatalogue(db);
  return db;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  const applied = row?.user_version ?? 0;
  for (let i = applied; i < MIGRATIONS.length; i++) {
    const sql = MIGRATIONS[i];
    if (!sql) continue;
    await db.execAsync(sql);
    // PRAGMA will not take a bound parameter, and i+1 is a loop counter -
    // never user input.
    await db.execAsync(`PRAGMA user_version = ${i + 1}`);
  }
}

/** Only for "delete everything and start again" in Settings. */
export async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM order_lines;
    DELETE FROM orders;
    DELETE FROM parties;
    DELETE FROM items;
    DELETE FROM brokers;
    DELETE FROM settings;
  `);
  await seedCatalogue(db);
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM settings WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}
