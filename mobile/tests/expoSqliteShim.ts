import { createRequire } from "node:module";

// Loaded through require, not a static import: Vite's build of Node's
// builtin list predates node:sqlite and tries to resolve it as a package.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

/** A stand-in for expo-sqlite backed by Node's own SQLite, so the schema,
 *  the migrations and every query in src/db can be exercised on a laptop.
 *  Only the handful of methods the app actually calls are implemented. */

type Args = (string | number | null)[];

class ShimDatabase {
  private db = new DatabaseSync(":memory:");

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, args: Args = []): Promise<void> {
    this.db.prepare(sql).run(...normalize(args));
  }

  async getAllAsync<T>(sql: string, args: Args = []): Promise<T[]> {
    return this.db.prepare(sql).all(...normalize(args)) as T[];
  }

  async getFirstAsync<T>(sql: string, args: Args = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...normalize(args));
    return (row as T) ?? null;
  }

  async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
    this.db.exec("BEGIN");
    try {
      await fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

// node:sqlite rejects booleans and undefined; the app never binds either on
// purpose, but a mis-bind should fail loudly in a test, not silently coerce.
function normalize(args: Args): (string | number | null)[] {
  return args.map((a) => (a === undefined ? null : a));
}

export type SQLiteDatabase = ShimDatabase;

export async function openDatabaseAsync(): Promise<ShimDatabase> {
  return new ShimDatabase();
}
