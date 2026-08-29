import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import AdmZip from "adm-zip";
import Database from "better-sqlite3";

// Builds a synthetic Vyapar backup that reproduces the quirks of the real
// schema - deliberately, because every one of them caused a production bug:
//
//   * kb_transactions has NO total-amount column. A sale's total is the sum
//     of its line items; txn_cash_amount is ~0 for credit sales.
//   * txn_balance_amount is NOT reduced when a payment is linked to the
//     invoice - it keeps the original amount forever.
//   * kb_lineitems has no item name, only item_id into kb_items.
//   * kb_names.amount is the party's authoritative running balance.
//   * txn_type 5 ("Receivable opening balance") carries its amount in
//     txn_balance_amount alone - no line items, no cash.
//   * Brokers are kb_party_groups referenced by kb_names.name_group_id.
//
// Using a generated fixture rather than a real backup keeps the tests
// runnable anywhere (CI included) and free of real customer data.

export type FixtureOptions = {
  /** Days before "today" that the sale invoices are dated. */
  saleAgesInDays?: number[];
};

const SCHEMA = `
CREATE TABLE kb_names (
  name_id INTEGER PRIMARY KEY,
  full_name TEXT,
  phone_number TEXT,
  email TEXT,
  address TEXT,
  amount REAL,
  name_group_id INTEGER
);
CREATE TABLE kb_party_groups (
  party_group_id INTEGER PRIMARY KEY,
  party_group_name TEXT
);
CREATE TABLE kb_transactions (
  txn_id INTEGER PRIMARY KEY,
  txn_name_id INTEGER,
  txn_type INTEGER,
  txn_date TEXT,
  txn_due_date TEXT,
  txn_ref_number_char TEXT,
  txn_cash_amount REAL,
  txn_balance_amount REAL,
  txn_description TEXT
);
CREATE TABLE kb_lineitems (
  lineitem_id INTEGER PRIMARY KEY,
  lineitem_txn_id INTEGER,
  item_id INTEGER,
  quantity REAL,
  priceperunit REAL,
  total_amount REAL
);
CREATE TABLE kb_items (
  item_id INTEGER PRIMARY KEY,
  item_name TEXT,
  item_stock_quantity REAL,
  item_sale_unit_price REAL,
  item_purchase_unit_price REAL
);
CREATE TABLE kb_txn_links (
  txn_links_id INTEGER PRIMARY KEY,
  txn_links_txn_1_id INTEGER,
  txn_links_txn_2_id INTEGER,
  txn_links_amount REAL,
  txn_links_txn_1_type INTEGER,
  txn_links_txn_2_type INTEGER
);
`;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} 00:00:00`;
}

/**
 * Writes a .vyb (zip containing a .vyp SQLite file) to a temp dir.
 *
 * The data models a small, deliberately-chosen book:
 *   - Ramesh   (id 1): 3 credit sales, one payment linked to the oldest.
 *                      Vyapar says he still owes 5000. In a broker group.
 *   - Suresh   (id 2): opening balance only, no invoices at all. Owes 2000.
 *   - Priya    (id 3): one recent sale, fully paid. Owes nothing.
 *   - Anil     (id 4): a sale, no phone number on file.
 */
export function makeFixtureVyb(opts: FixtureOptions = {}): { vybPath: string; dir: string } {
  const ages = opts.saleAgesInDays ?? [100, 60, 3];
  const dir = mkdtempSync(join(tmpdir(), "vyb-fixture-"));
  const vypPath = join(dir, "fixture.vyp");
  const db = new Database(vypPath);
  db.exec(SCHEMA);

  db.prepare(`INSERT INTO kb_party_groups VALUES (?, ?)`).run(10, "Tota Brokar");
  db.prepare(`INSERT INTO kb_party_groups VALUES (?, ?)`).run(11, "MAUGANJ");

  const insName = db.prepare(`INSERT INTO kb_names VALUES (?, ?, ?, ?, ?, ?, ?)`);
  //            id, name,     phone,        email, address, amount, group
  insName.run(1, "Ramesh Kirana", "9876543210", "", "", 5000, 10); // broker group
  insName.run(2, "Suresh Stores", "9876500002", "", "", 2000, 11); // geographic group
  insName.run(3, "Priya Traders", "9876500003", "", "", 0, null);
  insName.run(4, "Anil Shop", "", "", "", 1500, null); // no phone

  const insTxn = db.prepare(`INSERT INTO kb_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insLine = db.prepare(`INSERT INTO kb_lineitems VALUES (?, ?, ?, ?, ?, ?)`);

  db.prepare(`INSERT INTO kb_items VALUES (?, ?, ?, ?, ?)`).run(100, "Haldi 1kg", 50, 120, 100);
  db.prepare(`INSERT INTO kb_items VALUES (?, ?, ?, ?, ?)`).run(101, "Mirchi 1kg", 30, 200, 170);

  // --- Ramesh: 3 credit sales. Note cash = 0 on every one (credit), and
  // txn_balance_amount stays at the full invoice amount even for the sale
  // that has a payment linked to it below.
  const rameshSales = [
    { txnId: 1000, age: ages[0]!, amount: 3000, qty: 25, rate: 120, item: 100 },
    { txnId: 1001, age: ages[1]!, amount: 2000, qty: 10, rate: 200, item: 101 },
    { txnId: 1002, age: ages[2]!, amount: 4000, qty: 20, rate: 200, item: 101 },
  ];
  for (const s of rameshSales) {
    insTxn.run(s.txnId, 1, 1, isoDaysAgo(s.age), null, `INV-${s.txnId}`, 0, s.amount, null);
    insLine.run(s.txnId * 10, s.txnId, s.item, s.qty, s.rate, s.amount);
  }
  // A payment of 4000 that Vyapar links to the oldest sale. The sale's own
  // txn_balance_amount above is deliberately left untouched.
  insTxn.run(1010, 1, 3, isoDaysAgo(ages[1]!), null, null, 4000, 0, null);
  db.prepare(`INSERT INTO kb_txn_links VALUES (?, ?, ?, ?, ?, ?)`).run(1, 1010, 1000, 3000, 3, 1);

  // --- Suresh: opening balance ONLY. Amount lives in txn_balance_amount.
  insTxn.run(2000, 2, 5, isoDaysAgo(150), null, null, 0, 2000, "Receivable opening balance");

  // --- Priya: a recent sale she has fully paid (kb_names.amount = 0).
  insTxn.run(3000, 3, 1, isoDaysAgo(2), null, "INV-3000", 0, 1200, null);
  insLine.run(30000, 3000, 100, 10, 120, 1200);
  insTxn.run(3010, 3, 3, isoDaysAgo(1), null, null, 1200, 0, null);

  // --- Anil: one old sale, no phone on the party record.
  insTxn.run(4000, 4, 1, isoDaysAgo(90), null, "INV-4000", 0, 1500, null);
  insLine.run(40000, 4000, 101, 7.5, 200, 1500);

  db.close();

  const zip = new AdmZip();
  zip.addLocalFile(vypPath);
  const vybPath = join(dir, "fixture.vyb");
  writeFileSync(vybPath, zip.toBuffer());
  return { vybPath, dir };
}
