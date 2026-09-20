import type * as SQLite from "expo-sqlite";

import { nowISO, uid } from "../lib/id";
import { lineAmount, nextOrderNo } from "../lib/order";
import { round2 } from "../lib/money";

/** The shop's own catalogue, taken from its July 2026 sale report so the app
 *  is usable on the first screen instead of asking for an hour of typing.
 *  Rates are the last ones actually billed and are meant to be edited. */
const ITEMS: { name: string; rate: number }[] = [
  { name: "Biji Safed", rate: 115 },
  { name: "Biji 30 kg", rate: 121 },
  { name: "Biji VK", rate: 138 },
  { name: "Kesar Biji", rate: 145 },
  { name: "Dhaniya", rate: 165 },
  { name: "Haldi", rate: 148 },
];

const BROKERS = ["bitu", "jojo", "rajesh", "tota"];

const PARTIES: { name: string; phone: string | null }[] = [
  { name: "Anil pan masala Rewa", phone: "8319741238" },
  { name: "D.S. Atara", phone: null },
  { name: "Hargobind Sirmur", phone: "8085063107" },
  { name: "J. M. Rewa", phone: "9893400064" },
  { name: "Jo.jo.", phone: null },
  { name: "Lalji kirana stn", phone: "9300627522" },
  { name: "Mohanlal Rampurnaikin", phone: "9993468911" },
  { name: "Neeraj k jaitwara", phone: null },
  { name: "P.M..Atara", phone: "8543982922" },
  { name: "Pramod Jain Saleha", phone: null },
  { name: "Ramnarain mauganj", phone: "9806646570" },
  { name: "Sandeep Byohari New", phone: "8965916546" },
  { name: "Santosh Budwa", phone: "9584159838" },
  { name: "Sharda chamadiya stn", phone: "9893419067" },
];

const SEEDED_KEY = "catalogue_seeded";
const SAMPLES_KEY = "sample_orders_loaded";

/** Fills an empty database with the parties, items and brokers the shop
 *  already deals with. Runs once - after that the tables are the user's. */
export async function seedCatalogue(db: SQLite.SQLiteDatabase): Promise<void> {
  const seeded = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [SEEDED_KEY],
  );
  if (seeded?.value === "1") return;

  const now = nowISO();
  await db.withTransactionAsync(async () => {
    for (const item of ITEMS) {
      await db.runAsync(
        `INSERT INTO items (id, name, unit, default_rate, kg_per_bag, active, created_at, updated_at)
         VALUES (?, ?, 'kg', ?, 30, 1, ?, ?)`,
        [uid("itm_"), item.name, item.rate, now, now],
      );
    }
    for (const name of BROKERS) {
      await db.runAsync(
        "INSERT INTO brokers (id, name, commission_pct) VALUES (?, ?, 0)",
        [uid("brk_"), name],
      );
    }
    for (const party of PARTIES) {
      await db.runAsync(
        `INSERT INTO parties (id, name, phone, address, note, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
        [uid("pty_"), party.name, party.phone, now, now],
      );
    }
    await db.runAsync("INSERT INTO settings (key, value) VALUES (?, '1')", [
      SEEDED_KEY,
    ]);
  });
}

/** Real bills from the July 2026 report, so the dashboard and reports can be
 *  seen working before a single order has been written. Offered in Settings,
 *  never loaded on its own. */
const SAMPLE_ORDERS: {
  date: string;
  party: string;
  broker: string | null;
  lines: { item: string; bags: number; qty: number; rate: number }[];
}[] = [
  {
    date: "2026-07-03",
    party: "Lalji kirana stn",
    broker: null,
    lines: [{ item: "Kesar Biji", bags: 1, qty: 49.8, rate: 145 }],
  },
  {
    date: "2026-07-03",
    party: "J. M. Rewa",
    broker: null,
    lines: [{ item: "Biji VK", bags: 10, qty: 300.4, rate: 140 }],
  },
  {
    date: "2026-07-03",
    party: "D.S. Atara",
    broker: null,
    lines: [{ item: "Biji Safed", bags: 5, qty: 250, rate: 114 }],
  },
  {
    date: "2026-07-03",
    party: "Jo.jo.",
    broker: "jojo",
    lines: [{ item: "Biji 30 kg", bags: 8, qty: 239.9, rate: 118 }],
  },
  {
    date: "2026-07-03",
    party: "Sharda chamadiya stn",
    broker: "bitu",
    lines: [{ item: "Biji Safed", bags: 15, qty: 751.3, rate: 111.5 }],
  },
  {
    date: "2026-07-03",
    party: "Mohanlal Rampurnaikin",
    broker: null,
    lines: [{ item: "Biji 30 kg", bags: 5, qty: 150, rate: 119 }],
  },
  {
    date: "2026-07-03",
    party: "Hargobind Sirmur",
    broker: "rajesh",
    lines: [{ item: "Biji Safed", bags: 2, qty: 99.7, rate: 128 }],
  },
  {
    date: "2026-07-03",
    party: "Pramod Jain Saleha",
    broker: null,
    lines: [{ item: "Dhaniya", bags: 10, qty: 301, rate: 165 }],
  },
  {
    date: "2026-07-03",
    party: "Ramnarain mauganj",
    broker: "rajesh",
    lines: [{ item: "Biji 30 kg", bags: 10, qty: 299.2, rate: 121.5 }],
  },
  {
    date: "2026-07-02",
    party: "Jo.jo.",
    broker: "jojo",
    lines: [{ item: "Biji Safed", bags: 5, qty: 249.6, rate: 115 }],
  },
  {
    date: "2026-07-02",
    party: "Pramod Jain Saleha",
    broker: null,
    lines: [{ item: "Biji Safed", bags: 1, qty: 49.8, rate: 117 }],
  },
  {
    date: "2026-07-02",
    party: "Anil pan masala Rewa",
    broker: "rajesh",
    lines: [
      { item: "Biji VK", bags: 25, qty: 750, rate: 138 },
      { item: "Biji VK", bags: 15, qty: 450, rate: 138 },
      { item: "Biji 30 kg", bags: 10, qty: 300, rate: 121.5 },
    ],
  },
  {
    date: "2026-07-01",
    party: "Neeraj k jaitwara",
    broker: null,
    lines: [{ item: "Biji Safed", bags: 1, qty: 50, rate: 117 }],
  },
  {
    date: "2026-07-01",
    party: "Sandeep Byohari New",
    broker: null,
    lines: [{ item: "Biji Safed", bags: 5, qty: 249.7, rate: 115 }],
  },
  {
    date: "2026-07-01",
    party: "P.M..Atara",
    broker: "tota",
    lines: [{ item: "Biji Safed", bags: 3, qty: 149.8, rate: 116 }],
  },
  {
    date: "2026-07-01",
    party: "Santosh Budwa",
    broker: "rajesh",
    lines: [
      { item: "Haldi", bags: 2, qty: 101.3, rate: 148 },
      { item: "Biji 30 kg", bags: 10, qty: 300, rate: 121 },
    ],
  },
];

export async function sampleOrdersLoaded(
  db: SQLite.SQLiteDatabase,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [SAMPLES_KEY],
  );
  return row?.value === "1";
}

/** Returns how many bills were written. Unpaid on purpose: that is what the
 *  report they came from said, and it gives the outstanding figure something
 *  real to show. */
export async function loadSampleOrders(
  db: SQLite.SQLiteDatabase,
): Promise<number> {
  if (await sampleOrdersLoaded(db)) return 0;

  const parties = await db.getAllAsync<{ id: string; name: string }>(
    "SELECT id, name FROM parties",
  );
  const items = await db.getAllAsync<{ id: string; name: string }>(
    "SELECT id, name FROM items",
  );
  const brokers = await db.getAllAsync<{ id: string; name: string }>(
    "SELECT id, name FROM brokers",
  );
  const partyByName = new Map(parties.map((p) => [p.name, p.id]));
  const itemByName = new Map(items.map((i) => [i.name, i.id]));
  const brokerByName = new Map(brokers.map((b) => [b.name, b.id]));

  const now = nowISO();
  let written = 0;

  // Oldest first, so the order numbers run in the same direction as the dates.
  const ordered = [...SAMPLE_ORDERS].sort((a, b) => a.date.localeCompare(b.date));

  // The samples can be loaded into a book that already has orders in it, so
  // numbering carries on from the last one rather than restarting at 0001
  // and colliding with it.
  const last = await db.getFirstAsync<{ order_no: string }>(
    "SELECT order_no FROM orders ORDER BY order_no DESC LIMIT 1",
  );
  let lastOrderNo = last?.order_no ?? null;

  await db.withTransactionAsync(async () => {
    for (const sample of ordered) {
      const partyId = partyByName.get(sample.party);
      if (!partyId) continue;

      const orderId = uid("ord_");
      const subtotal = round2(
        sample.lines.reduce((sum, l) => sum + lineAmount(l.qty, l.rate), 0),
      );
      const orderNo = nextOrderNo(lastOrderNo, sample.date);
      lastOrderNo = orderNo;
      const brokerId = sample.broker
        ? (brokerByName.get(sample.broker) ?? null)
        : null;

      await db.runAsync(
        `INSERT INTO orders (id, order_no, party_id, party_name, broker_id, broker_name,
                             date, status, note, subtotal, discount, total, received, balance,
                             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'delivered', NULL, ?, 0, ?, 0, ?, ?, ?)`,
        [
          orderId,
          orderNo,
          partyId,
          sample.party,
          brokerId,
          sample.broker,
          sample.date,
          subtotal,
          subtotal,
          subtotal,
          now,
          now,
        ],
      );

      for (const [i, line] of sample.lines.entries()) {
        await db.runAsync(
          `INSERT INTO order_lines (id, order_id, item_id, item_name, bags, qty, rate, amount, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uid("lin_"),
            orderId,
            itemByName.get(line.item) ?? null,
            line.item,
            line.bags,
            line.qty,
            line.rate,
            lineAmount(line.qty, line.rate),
            i,
          ],
        );
      }
      written++;
    }
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
      [SAMPLES_KEY],
    );
  });

  return written;
}
