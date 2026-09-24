import { getDb } from "./index";
import { nowISO, uid } from "../lib/id";
import { todayISO } from "../lib/date";
import { computeTotals, lineAmount, nextChallanNo, nextOrderNo } from "../lib/order";
import { parseAmount, round2 } from "../lib/money";
import type {
  Broker,
  Challan,
  Item,
  Order,
  OrderLine,
  OrderStatus,
  OrderWithLines,
  Party,
  Transporter,
} from "../lib/types";

/* ------------------------------------------------------------------ rows */
// SQLite gives back exactly the column names, so the snake_case -> camelCase
// translation happens here, once, instead of leaking into every screen.

interface PartyRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  name: string;
  unit: string;
  default_rate: number;
  kg_per_bag: number;
  active: number;
  created_at: string;
  updated_at: string;
}

interface OrderRow {
  id: string;
  order_no: string;
  party_id: string;
  party_name: string;
  broker_id: string | null;
  broker_name: string | null;
  date: string;
  status: string;
  note: string | null;
  transporter_id: string | null;
  transporter_name: string | null;
  vehicle_no: string | null;
  subtotal: number;
  discount: number;
  total: number;
  received: number;
  balance: number;
  created_at: string;
  updated_at: string;
}

interface LineRow {
  id: string;
  order_id: string;
  item_id: string | null;
  item_name: string;
  bags: number | null;
  qty: number;
  rate: number;
  amount: number;
  position: number;
}

const toParty = (r: PartyRow): Party => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  address: r.address,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  defaultRate: r.default_rate,
  kgPerBag: r.kg_per_bag,
  active: r.active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toOrder = (r: OrderRow): Order => ({
  id: r.id,
  orderNo: r.order_no,
  partyId: r.party_id,
  partyName: r.party_name,
  brokerId: r.broker_id,
  brokerName: r.broker_name,
  date: r.date,
  status: r.status as OrderStatus,
  note: r.note,
  transporterId: r.transporter_id,
  transporterName: r.transporter_name,
  vehicleNo: r.vehicle_no,
  subtotal: r.subtotal,
  discount: r.discount,
  total: r.total,
  received: r.received,
  balance: r.balance,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toLine = (r: LineRow): OrderLine => ({
  id: r.id,
  orderId: r.order_id,
  itemId: r.item_id,
  itemName: r.item_name,
  bags: r.bags,
  qty: r.qty,
  rate: r.rate,
  amount: r.amount,
  position: r.position,
});

/* ---------------------------------------------------------------- parties */

export async function listParties(search = ""): Promise<Party[]> {
  const db = await getDb();
  const term = `%${search.trim()}%`;
  const rows = await db.getAllAsync<PartyRow>(
    `SELECT * FROM parties
     WHERE (? = '' OR name LIKE ? COLLATE NOCASE OR IFNULL(phone,'') LIKE ?)
     ORDER BY name COLLATE NOCASE`,
    [search.trim(), term, term],
  );
  return rows.map(toParty);
}

/** The list screen wants the money next to the name; two queries and a join
 *  in memory beats a correlated subquery per row. */
export async function listPartiesWithBalance(
  search = "",
): Promise<(Party & { balance: number; orderCount: number })[]> {
  const db = await getDb();
  const parties = await listParties(search);
  const sums = await db.getAllAsync<{
    party_id: string;
    balance: number;
    order_count: number;
  }>(
    `SELECT party_id, SUM(balance) AS balance, COUNT(*) AS order_count
     FROM orders WHERE status != 'cancelled' GROUP BY party_id`,
  );
  const byId = new Map(sums.map((s) => [s.party_id, s]));
  return parties.map((p) => ({
    ...p,
    balance: round2(byId.get(p.id)?.balance ?? 0),
    orderCount: byId.get(p.id)?.order_count ?? 0,
  }));
}

export async function getParty(id: string): Promise<Party | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<PartyRow>(
    "SELECT * FROM parties WHERE id = ?",
    [id],
  );
  return row ? toParty(row) : null;
}

export async function saveParty(input: {
  id?: string | null;
  name: string;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
}): Promise<string> {
  const db = await getDb();
  const now = nowISO();
  const name = input.name.trim();
  const phone = input.phone?.trim() || null;
  const address = input.address?.trim() || null;
  const note = input.note?.trim() || null;

  if (input.id) {
    await db.runAsync(
      `UPDATE parties SET name = ?, phone = ?, address = ?, note = ?, updated_at = ? WHERE id = ?`,
      [name, phone, address, note, now, input.id],
    );
    // Orders carry their own copy of the name so history stays readable;
    // a rename is a correction, so the open book follows it.
    await db.runAsync("UPDATE orders SET party_name = ? WHERE party_id = ?", [
      name,
      input.id,
    ]);
    return input.id;
  }

  const id = uid("pty_");
  await db.runAsync(
    `INSERT INTO parties (id, name, phone, address, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, phone, address, note, now, now],
  );
  return id;
}

/** Refuses rather than orphaning bills - a party with history is deactivated
 *  by the user, not deleted. */
export async function deleteParty(id: string): Promise<{ ok: boolean; reason?: string }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM orders WHERE party_id = ?",
    [id],
  );
  if ((row?.n ?? 0) > 0) {
    return { ok: false, reason: `This party has ${row?.n} order(s).` };
  }
  await db.runAsync("DELETE FROM parties WHERE id = ?", [id]);
  return { ok: true };
}

/* ------------------------------------------------------------------ items */

export async function listItems(search = ""): Promise<Item[]> {
  const db = await getDb();
  const term = `%${search.trim()}%`;
  const rows = await db.getAllAsync<ItemRow>(
    `SELECT * FROM items
     WHERE (? = '' OR name LIKE ? COLLATE NOCASE)
     ORDER BY active DESC, name COLLATE NOCASE`,
    [search.trim(), term],
  );
  return rows.map(toItem);
}

export async function saveItem(input: {
  id?: string | null;
  name: string;
  unit?: string;
  defaultRate: number;
  kgPerBag: number;
  active?: boolean;
}): Promise<string> {
  const db = await getDb();
  const now = nowISO();
  const name = input.name.trim();
  const unit = (input.unit || "kg").trim();
  const rate = round2(input.defaultRate);
  const kgPerBag = round2(input.kgPerBag) || 30;
  const active = input.active === false ? 0 : 1;

  if (input.id) {
    await db.runAsync(
      `UPDATE items SET name = ?, unit = ?, default_rate = ?, kg_per_bag = ?, active = ?, updated_at = ?
       WHERE id = ?`,
      [name, unit, rate, kgPerBag, active, now, input.id],
    );
    return input.id;
  }
  const id = uid("itm_");
  await db.runAsync(
    `INSERT INTO items (id, name, unit, default_rate, kg_per_bag, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, unit, rate, kgPerBag, active, now, now],
  );
  return id;
}

/** Past bills keep the item's name, so removing it from the catalogue costs
 *  no history - the line's item_id is simply forgotten. */
export async function deleteItem(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE order_lines SET item_id = NULL WHERE item_id = ?", [id]);
  await db.runAsync("DELETE FROM items WHERE id = ?", [id]);
}

/* ---------------------------------------------------------------- brokers */

export async function listBrokers(): Promise<Broker[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    commission_pct: number;
  }>("SELECT * FROM brokers ORDER BY name COLLATE NOCASE");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    commissionPct: r.commission_pct,
  }));
}

export async function saveBroker(input: {
  id?: string | null;
  name: string;
  commissionPct?: number;
}): Promise<string> {
  const db = await getDb();
  const name = input.name.trim();
  const pct = round2(input.commissionPct ?? 0);
  if (input.id) {
    await db.runAsync(
      "UPDATE brokers SET name = ?, commission_pct = ? WHERE id = ?",
      [name, pct, input.id],
    );
    await db.runAsync("UPDATE orders SET broker_name = ? WHERE broker_id = ?", [
      name,
      input.id,
    ]);
    return input.id;
  }
  const id = uid("brk_");
  await db.runAsync(
    "INSERT INTO brokers (id, name, commission_pct) VALUES (?, ?, ?)",
    [id, name, pct],
  );
  return id;
}

export async function deleteBroker(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE orders SET broker_id = NULL WHERE broker_id = ?",
    [id],
  );
  await db.runAsync("DELETE FROM brokers WHERE id = ?", [id]);
}

/* ----------------------------------------------------------------- orders */

export interface OrderFilter {
  search?: string;
  status?: OrderStatus | "all" | "unpaid" | "to-deliver";
  partyId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export async function listOrders(filter: OrderFilter = {}): Promise<Order[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];

  const search = filter.search?.trim() ?? "";
  if (search) {
    where.push(
      "(party_name LIKE ? COLLATE NOCASE OR order_no LIKE ? COLLATE NOCASE OR IFNULL(broker_name,'') LIKE ? COLLATE NOCASE)",
    );
    const term = `%${search}%`;
    args.push(term, term, term);
  }
  if (filter.status && filter.status !== "all") {
    if (filter.status === "unpaid") {
      // "Money still out" is the question actually being asked, and a
      // cancelled bill is not money anyone owes.
      where.push("balance > 0 AND status != 'cancelled'");
    } else if (filter.status === "to-deliver") {
      // One bucket for everything still waiting on a gadi.
      where.push("status IN ('pending','packed')");
    } else {
      where.push("status = ?");
      args.push(filter.status);
    }
  }
  if (filter.partyId) {
    where.push("party_id = ?");
    args.push(filter.partyId);
  }
  if (filter.from) {
    where.push("date >= ?");
    args.push(filter.from);
  }
  if (filter.to) {
    where.push("date <= ?");
    args.push(filter.to);
  }

  const sql = `SELECT * FROM orders
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY date DESC, created_at DESC
     LIMIT ?`;
  args.push(filter.limit ?? 200);

  const rows = await db.getAllAsync<OrderRow>(sql, args);
  return rows.map(toOrder);
}

export async function getOrder(id: string): Promise<OrderWithLines | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<OrderRow>(
    "SELECT * FROM orders WHERE id = ?",
    [id],
  );
  if (!row) return null;
  const lines = await db.getAllAsync<LineRow>(
    "SELECT * FROM order_lines WHERE order_id = ? ORDER BY position",
    [id],
  );
  return { ...toOrder(row), lines: lines.map(toLine) };
}

export interface SaveOrderInput {
  id?: string | null;
  partyId: string;
  partyName: string;
  brokerId: string | null;
  brokerName: string | null;
  date: string;
  status: OrderStatus;
  note: string | null;
  /** The lorry, when it is already known. An order can be written before one
   *  is arranged, so these are optional. */
  transporterId?: string | null;
  transporterName?: string | null;
  vehicleNo?: string | null;
  discount: number;
  received: number;
  lines: {
    itemId: string | null;
    itemName: string;
    bags: number | null;
    qty: number;
    rate: number;
  }[];
}

/** Writes the bill and its lines together. Totals are recomputed here rather
 *  than trusted from the form, so what is stored always re-adds. */
export async function saveOrder(input: SaveOrderInput): Promise<string> {
  const db = await getDb();
  const now = nowISO();
  const totals = computeTotals(input.lines, input.discount, input.received);
  const id = input.id ?? uid("ord_");

  await db.withTransactionAsync(async () => {
    if (input.id) {
      await db.runAsync(
        `UPDATE orders SET party_id = ?, party_name = ?, broker_id = ?, broker_name = ?,
                           date = ?, status = ?, note = ?, transporter_id = ?,
                           transporter_name = ?, vehicle_no = ?, subtotal = ?, discount = ?,
                           total = ?, received = ?, balance = ?, updated_at = ?
         WHERE id = ?`,
        [
          input.partyId,
          input.partyName,
          input.brokerId,
          input.brokerName,
          input.date,
          input.status,
          input.note,
          input.transporterId ?? null,
          input.transporterName ?? null,
          input.vehicleNo ?? null,
          totals.subtotal,
          totals.discount,
          totals.total,
          totals.received,
          totals.balance,
          now,
          input.id,
        ],
      );
      // Lines are replaced wholesale: editing a bill is rare, and diffing
      // rows would be a lot of code to save one delete.
      await db.runAsync("DELETE FROM order_lines WHERE order_id = ?", [input.id]);
    } else {
      const last = await db.getFirstAsync<{ order_no: string }>(
        "SELECT order_no FROM orders ORDER BY order_no DESC LIMIT 1",
      );
      const orderNo = nextOrderNo(last?.order_no ?? null, input.date);
      await db.runAsync(
        `INSERT INTO orders (id, order_no, party_id, party_name, broker_id, broker_name,
                             date, status, note, transporter_id, transporter_name, vehicle_no,
                             subtotal, discount, total, received, balance,
                             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          orderNo,
          input.partyId,
          input.partyName,
          input.brokerId,
          input.brokerName,
          input.date,
          input.status,
          input.note,
          input.transporterId ?? null,
          input.transporterName ?? null,
          input.vehicleNo ?? null,
          totals.subtotal,
          totals.discount,
          totals.total,
          totals.received,
          totals.balance,
          now,
          now,
        ],
      );
    }

    for (const [i, line] of input.lines.entries()) {
      await db.runAsync(
        `INSERT INTO order_lines (id, order_id, item_id, item_name, bags, qty, rate, amount, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uid("lin_"),
          id,
          line.itemId,
          line.itemName,
          line.bags,
          round2(line.qty),
          round2(line.rate),
          lineAmount(line.qty, line.rate),
          i,
        ],
      );
    }
  });

  return id;
}

export async function setOrderStatus(
  id: string,
  status: OrderStatus,
): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", [
    status,
    nowISO(),
    id,
  ]);
}

/** Adds to what has already been received and re-derives the balance, so a
 *  part payment can be entered as the amount handed over rather than as a
 *  running total the user has to work out. */
export async function addPayment(id: string, amount: number): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<OrderRow>(
    "SELECT * FROM orders WHERE id = ?",
    [id],
  );
  if (!row) return;
  const received = Math.min(round2(row.received + parseAmount(amount)), row.total);
  await db.runAsync(
    "UPDATE orders SET received = ?, balance = ?, updated_at = ? WHERE id = ?",
    [received, round2(row.total - received), nowISO(), id],
  );
}

export async function deleteOrder(id: string): Promise<void> {
  const db = await getDb();
  // order_lines cascades, but only because PRAGMA foreign_keys is on.
  await db.runAsync("DELETE FROM orders WHERE id = ?", [id]);
}

/** Orders with their lines attached, for CSV export. One query for the lines
 *  rather than one per order. */
export async function listOrdersWithLines(
  filter: OrderFilter = {},
): Promise<OrderWithLines[]> {
  const db = await getDb();
  const orders = await listOrders({ ...filter, limit: filter.limit ?? 5000 });
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const placeholders = ids.map(() => "?").join(",");
  const lines = await db.getAllAsync<LineRow>(
    `SELECT * FROM order_lines WHERE order_id IN (${placeholders}) ORDER BY position`,
    ids,
  );
  const byOrder = new Map<string, OrderLine[]>();
  for (const row of lines) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push(toLine(row));
    byOrder.set(row.order_id, list);
  }
  return orders.map((o) => ({ ...o, lines: byOrder.get(o.id) ?? [] }));
}

/* -------------------------------------------------------------- dashboard */

export interface Dashboard {
  todaySales: number;
  todayOrders: number;
  monthSales: number;
  monthOrders: number;
  pendingOrders: number;
  outstanding: number;
  unpaidOrders: number;
  monthKg: number;
  /** Every bill ever written that was not cancelled. */
  totalOrders: number;
  totalSales: number;
  /** Still to go out - the weight is what decides how many gadis are needed. */
  toDeliverKg: number;
  deliveredOrders: number;
  deliveredMonthOrders: number;
}

export async function getDashboard(
  today: string,
  monthFrom: string,
  monthTo: string,
): Promise<Dashboard> {
  const db = await getDb();
  const live = "status != 'cancelled'";

  const todayRow = await db.getFirstAsync<{ total: number; n: number }>(
    `SELECT IFNULL(SUM(total),0) AS total, COUNT(*) AS n FROM orders WHERE date = ? AND ${live}`,
    [today],
  );
  const monthRow = await db.getFirstAsync<{ total: number; n: number }>(
    `SELECT IFNULL(SUM(total),0) AS total, COUNT(*) AS n FROM orders
     WHERE date BETWEEN ? AND ? AND ${live}`,
    [monthFrom, monthTo],
  );
  const pendingRow = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending','packed')",
  );
  const dueRow = await db.getFirstAsync<{ total: number; n: number }>(
    `SELECT IFNULL(SUM(balance),0) AS total, COUNT(*) AS n FROM orders
     WHERE balance > 0 AND ${live}`,
  );
  const kgRow = await db.getFirstAsync<{ kg: number }>(
    `SELECT IFNULL(SUM(l.qty),0) AS kg FROM order_lines l
     JOIN orders o ON o.id = l.order_id
     WHERE o.date BETWEEN ? AND ? AND o.${live}`,
    [monthFrom, monthTo],
  );
  const allRow = await db.getFirstAsync<{ total: number; n: number }>(
    `SELECT IFNULL(SUM(total),0) AS total, COUNT(*) AS n FROM orders WHERE ${live}`,
  );
  const toDeliverKgRow = await db.getFirstAsync<{ kg: number }>(
    `SELECT IFNULL(SUM(l.qty),0) AS kg FROM order_lines l
     JOIN orders o ON o.id = l.order_id
     WHERE o.status IN ('pending','packed')`,
  );
  const deliveredRow = await db.getFirstAsync<{ n: number; month: number }>(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS month
     FROM orders WHERE status = 'delivered'`,
    [monthFrom, monthTo],
  );

  return {
    todaySales: round2(todayRow?.total ?? 0),
    todayOrders: todayRow?.n ?? 0,
    monthSales: round2(monthRow?.total ?? 0),
    monthOrders: monthRow?.n ?? 0,
    pendingOrders: pendingRow?.n ?? 0,
    outstanding: round2(dueRow?.total ?? 0),
    unpaidOrders: dueRow?.n ?? 0,
    monthKg: round2(kgRow?.kg ?? 0),
    totalOrders: allRow?.n ?? 0,
    totalSales: round2(allRow?.total ?? 0),
    toDeliverKg: round2(toDeliverKgRow?.kg ?? 0),
    deliveredOrders: deliveredRow?.n ?? 0,
    deliveredMonthOrders: deliveredRow?.month ?? 0,
  };
}

export interface TopRow {
  name: string;
  total: number;
  count: number;
}

export async function topParties(
  from: string,
  to: string,
  limit = 5,
): Promise<(TopRow & { kg: number })[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    name: string;
    total: number;
    kg: number;
    n: number;
  }>(
    `SELECT o.party_name AS name, SUM(o.total) AS total, COUNT(*) AS n,
            IFNULL(SUM(k.kg), 0) AS kg
     FROM orders o
     LEFT JOIN (SELECT order_id, SUM(qty) AS kg FROM order_lines GROUP BY order_id) k
            ON k.order_id = o.id
     WHERE o.date BETWEEN ? AND ? AND o.status != 'cancelled'
     GROUP BY o.party_id ORDER BY kg DESC LIMIT ?`,
    [from, to, limit],
  );
  return rows.map((r) => ({
    name: r.name,
    total: round2(r.total),
    kg: round2(r.kg),
    count: r.n,
  }));
}

export async function topItems(
  from: string,
  to: string,
  limit = 5,
): Promise<(TopRow & { kg: number })[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    name: string;
    total: number;
    kg: number;
    n: number;
  }>(
    `SELECT l.item_name AS name, SUM(l.amount) AS total, SUM(l.qty) AS kg, COUNT(*) AS n
     FROM order_lines l JOIN orders o ON o.id = l.order_id
     WHERE o.date BETWEEN ? AND ? AND o.status != 'cancelled'
     GROUP BY l.item_name COLLATE NOCASE ORDER BY total DESC LIMIT ?`,
    [from, to, limit],
  );
  return rows.map((r) => ({
    name: r.name,
    total: round2(r.total),
    kg: round2(r.kg),
    count: r.n,
  }));
}

export async function brokerSummary(
  from: string,
  to: string,
): Promise<(TopRow & { commissionPct: number; brokerage: number })[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    name: string;
    total: number;
    n: number;
    pct: number | null;
  }>(
    `SELECT o.broker_name AS name, SUM(o.total) AS total, COUNT(*) AS n,
            MAX(b.commission_pct) AS pct
     FROM orders o LEFT JOIN brokers b ON b.id = o.broker_id
     WHERE o.date BETWEEN ? AND ? AND o.status != 'cancelled' AND o.broker_name IS NOT NULL
     GROUP BY o.broker_name COLLATE NOCASE ORDER BY total DESC`,
    [from, to],
  );
  return rows.map((r) => {
    const pct = r.pct ?? 0;
    return {
      name: r.name,
      total: round2(r.total),
      count: r.n,
      commissionPct: pct,
      brokerage: round2((r.total * pct) / 100),
    };
  });
}

/** Daily totals for the month, for the bar strip on the dashboard. */
export async function dailyTotals(
  from: string,
  to: string,
): Promise<{ date: string; total: number }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string; total: number }>(
    `SELECT date, SUM(total) AS total FROM orders
     WHERE date BETWEEN ? AND ? AND status != 'cancelled'
     GROUP BY date ORDER BY date`,
    [from, to],
  );
  return rows.map((r) => ({ date: r.date, total: round2(r.total) }));
}


/* ----------------------------------------------------------- transporters */

interface TransporterRow {
  id: string;
  name: string;
  phone: string | null;
}

export async function listTransporters(): Promise<Transporter[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TransporterRow>(
    "SELECT * FROM transporters ORDER BY name COLLATE NOCASE",
  );
  return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone }));
}

export async function saveTransporter(input: {
  id?: string | null;
  name: string;
  phone?: string | null;
}): Promise<string> {
  const db = await getDb();
  const name = input.name.trim();
  const phone = input.phone?.trim() || null;
  if (input.id) {
    await db.runAsync("UPDATE transporters SET name = ?, phone = ? WHERE id = ?", [
      name,
      phone,
      input.id,
    ]);
    return input.id;
  }
  const id = uid("trp_");
  await db.runAsync(
    "INSERT INTO transporters (id, name, phone) VALUES (?, ?, ?)",
    [id, name, phone],
  );
  return id;
}

/** Challans keep their own copy of the name, so removing a transporter from
 *  the list costs no paperwork. */
export async function deleteTransporter(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE challans SET transporter_id = NULL WHERE transporter_id = ?", [id]);
  await db.runAsync("DELETE FROM transporters WHERE id = ?", [id]);
}

/* --------------------------------------------------------------- challans */

interface ChallanRow {
  id: string;
  challan_no: string;
  order_id: string;
  date: string;
  transporter_id: string | null;
  transporter_name: string | null;
  transporter_phone: string | null;
  vehicle_no: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  lr_no: string | null;
  destination: string | null;
  note: string | null;
  show_rates: number;
  created_at: string;
  updated_at: string;
}

const toChallan = (r: ChallanRow): Challan => ({
  id: r.id,
  challanNo: r.challan_no,
  orderId: r.order_id,
  date: r.date,
  transporterId: r.transporter_id,
  transporterName: r.transporter_name,
  transporterPhone: r.transporter_phone,
  vehicleNo: r.vehicle_no,
  driverName: r.driver_name,
  driverPhone: r.driver_phone,
  lrNo: r.lr_no,
  destination: r.destination,
  note: r.note,
  showRates: r.show_rates === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function getChallanForOrder(orderId: string): Promise<Challan | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ChallanRow>(
    "SELECT * FROM challans WHERE order_id = ? ORDER BY created_at LIMIT 1",
    [orderId],
  );
  return row ? toChallan(row) : null;
}

/** Issues the challan for an order, copying everything it prints from the
 *  order itself - party, destination, goods, lorry - so nothing is typed a
 *  second time. Issued once: printing again reuses the same number, because a
 *  challan number must not change under a lorry that already left with it. */
export async function issueChallan(orderId: string): Promise<Challan> {
  const db = await getDb();
  const now = nowISO();

  const order = await getOrder(orderId);
  if (!order) throw new Error("That order could not be found.");
  const party = await getParty(order.partyId);

  const existing = await getChallanForOrder(orderId);
  const values = {
    date: todayISO(),
    transporterId: order.transporterId,
    transporterName: order.transporterName,
    // The lorry's own number is on the transporter record, not the order.
    transporterPhone: order.transporterId
      ? ((await listTransporters()).find((t) => t.id === order.transporterId)?.phone ?? null)
      : null,
    vehicleNo: order.vehicleNo,
    destination: party?.address ?? null,
    note: order.note,
  };

  if (existing) {
    await db.runAsync(
      `UPDATE challans SET transporter_id = ?, transporter_name = ?, transporter_phone = ?,
              vehicle_no = ?, destination = ?, note = ?, updated_at = ?
       WHERE id = ?`,
      [
        values.transporterId,
        values.transporterName,
        values.transporterPhone,
        values.vehicleNo,
        values.destination,
        values.note,
        now,
        existing.id,
      ],
    );
  } else {
    const last = await db.getFirstAsync<{ challan_no: string }>(
      "SELECT challan_no FROM challans ORDER BY challan_no DESC LIMIT 1",
    );
    await db.runAsync(
      `INSERT INTO challans (id, challan_no, order_id, date, transporter_id, transporter_name,
                             transporter_phone, vehicle_no, driver_name, driver_phone, lr_no,
                             destination, note, show_rates, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 0, ?, ?)`,
      [
        uid("chl_"),
        nextChallanNo(last?.challan_no ?? null, values.date),
        orderId,
        values.date,
        values.transporterId,
        values.transporterName,
        values.transporterPhone,
        values.vehicleNo,
        values.destination,
        values.note,
        now,
        now,
      ],
    );
  }

  const challan = await getChallanForOrder(orderId);
  if (!challan) throw new Error("Challan could not be written.");
  return challan;
}

export async function deleteChallan(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM challans WHERE id = ?", [id]);
}

/** Order ids that already have a challan, so a list can mark them without a
 *  query per row. */
export async function challanOrderIds(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const db = await getDb();
  const placeholders = orderIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ order_id: string }>(
    `SELECT DISTINCT order_id FROM challans WHERE order_id IN (${placeholders})`,
    orderIds,
  );
  return new Set(rows.map((r) => r.order_id));
}
