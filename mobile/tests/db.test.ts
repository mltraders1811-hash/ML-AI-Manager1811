import { beforeAll, describe, expect, it } from "vitest";

import { getDb, migrate, resetDb } from "../src/db";
import { MIGRATIONS } from "../src/db/schema";
import { openDatabaseAsync } from "./expoSqliteShim";
import { loadSampleOrders, sampleOrdersLoaded } from "../src/db/seed";
import { exportBackup, restoreBackup } from "../src/db/backup";
import {
  addPayment,
  deleteChallan,
  getChallanForOrder,
  listTransporters,
  issueChallan,
  saveTransporter,
  brokerSummary,
  deleteOrder,
  deleteParty,
  getDashboard,
  getOrder,
  listBrokers,
  listItems,
  listOrders,
  listOrdersWithLines,
  listParties,
  listPartiesWithBalance,
  saveBroker,
  saveItem,
  saveOrder,
  saveParty,
  setOrderStatus,
  topItems,
  topParties,
} from "../src/db/queries";
import { ordersToCsv } from "../src/lib/csv";

// One in-memory database for the file, built exactly the way the app builds
// it on first launch: migrations, then the shop's own catalogue.
beforeAll(async () => {
  await getDb();
});

describe("first launch", () => {
  it("seeds the catalogue the shop already sells", async () => {
    const items = await listItems();
    const parties = await listParties();
    const brokers = await listBrokers();
    expect(items.map((i) => i.name)).toContain("Biji Safed");
    expect(items.find((i) => i.name === "Dhaniya")?.defaultRate).toBe(165);
    expect(parties).toHaveLength(14);
    expect(brokers.map((b) => b.name)).toEqual(["bitu", "jojo", "rajesh", "tota"]);
  });

  it("seeds a catalogue but no orders", async () => {
    expect(await listOrders()).toHaveLength(0);
  });

  it("does not seed twice when the app is reopened", async () => {
    const db = await getDb();
    const before = (await listItems()).length;
    // seedCatalogue runs on every open; the flag is what stops it doubling
    // the catalogue every time the app starts.
    const { seedCatalogue } = await import("../src/db/seed");
    await seedCatalogue(db as never);
    expect(await listItems()).toHaveLength(before);
  });
});

describe("writing an order", () => {
  it("numbers, totals and stores it with its lines", async () => {
    const party = (await listParties()).find((p) => p.name === "J. M. Rewa")!;
    const item = (await listItems()).find((i) => i.name === "Biji VK")!;

    const id = await saveOrder({
      partyId: party.id,
      partyName: party.name,
      brokerId: null,
      brokerName: null,
      date: "2026-07-03",
      status: "pending",
      note: "Load on the evening truck",
      discount: 0,
      received: 0,
      lines: [{ itemId: item.id, itemName: item.name, bags: 10, qty: 300.4, rate: 140 }],
    });

    const order = await getOrder(id);
    expect(order?.orderNo).toBe("ORD-2026-0001");
    expect(order?.total).toBe(42_056);
    expect(order?.balance).toBe(42_056);
    expect(order?.lines).toHaveLength(1);
    expect(order?.lines[0]?.amount).toBe(42_056);
  });

  it("gives the next order its own number", async () => {
    const party = (await listParties())[0]!;
    const id = await saveOrder({
      partyId: party.id,
      partyName: party.name,
      brokerId: null,
      brokerName: null,
      date: "2026-07-03",
      status: "pending",
      note: null,
      discount: 0,
      received: 0,
      lines: [{ itemId: null, itemName: "Haldi", bags: null, qty: 100, rate: 148 }],
    });
    expect((await getOrder(id))?.orderNo).toBe("ORD-2026-0002");
  });

  it("replaces the lines when the order is edited, without duplicating them", async () => {
    const existing = (await listOrders())[0]!;
    const full = await getOrder(existing.id);
    await saveOrder({
      id: existing.id,
      partyId: full!.partyId,
      partyName: full!.partyName,
      brokerId: null,
      brokerName: null,
      date: full!.date,
      status: "packed",
      note: null,
      discount: 100,
      received: 1000,
      lines: [
        { itemId: null, itemName: "Haldi", bags: 1, qty: 50, rate: 148 },
        { itemId: null, itemName: "Dhaniya", bags: 1, qty: 50, rate: 165 },
      ],
    });
    const updated = await getOrder(existing.id);
    expect(updated?.lines).toHaveLength(2);
    expect(updated?.subtotal).toBe(15_650);
    expect(updated?.total).toBe(15_550);
    expect(updated?.balance).toBe(14_550);
    expect(updated?.orderNo).toBe(existing.orderNo);
  });
});

describe("payments", () => {
  it("adds up what has been handed over and stops at the total", async () => {
    const order = (await listOrders({ status: "unpaid" }))[0]!;
    await addPayment(order.id, 1000);
    await addPayment(order.id, 500);
    const after = await getOrder(order.id);
    expect(after?.received).toBe(order.received + 1500);

    await addPayment(order.id, 9_999_999);
    const settled = await getOrder(order.id);
    expect(settled?.received).toBe(settled?.total);
    expect(settled?.balance).toBe(0);
  });
});

describe("filters", () => {
  it("finds orders by party, status and date", async () => {
    expect((await listOrders({ search: "J. M." })).length).toBeGreaterThan(0);
    expect(await listOrders({ status: "packed" })).toHaveLength(1);
    expect(await listOrders({ from: "2027-01-01" })).toHaveLength(0);
  });

  it("puts pending and packed in one 'to deliver' bucket", async () => {
    const pending = await listOrders({ status: "pending" });
    const packed = await listOrders({ status: "packed" });
    const toDeliver = await listOrders({ status: "to-deliver" });
    expect(toDeliver).toHaveLength(pending.length + packed.length);
    expect(toDeliver.every((o) => o.status === "pending" || o.status === "packed")).toBe(
      true,
    );
  });

  it("counts a cancelled order out of the money owed", async () => {
    const target = (await listOrders({ status: "unpaid" }))[0];
    if (!target) return;
    await setOrderStatus(target.id, "cancelled");
    const unpaid = await listOrders({ status: "unpaid" });
    expect(unpaid.find((o) => o.id === target.id)).toBeUndefined();
    await setOrderStatus(target.id, "pending");
  });
});

describe("sample orders", () => {
  it("loads the July 2026 report once", async () => {
    const db = await getDb();
    expect(await sampleOrdersLoaded(db as never)).toBe(false);
    const written = await loadSampleOrders(db as never);
    expect(written).toBe(16);
    expect(await loadSampleOrders(db as never)).toBe(0);
  });

  it("reports the month the way the report did", async () => {
    const dashboard = await getDashboard("2026-07-03", "2026-07-01", "2026-07-31");
    // The 16 sample bills plus the two written above.
    expect(dashboard.monthOrders).toBe(18);
    expect(dashboard.monthSales).toBeGreaterThan(600_000);
  });

  it("counts every order on the book, not just this month's", async () => {
    const dashboard = await getDashboard("2026-07-03", "2026-07-01", "2026-07-31");
    const live = (await listOrders({ limit: 5000 })).filter(
      (o) => o.status !== "cancelled",
    );
    expect(dashboard.totalOrders).toBe(live.length);
    expect(dashboard.deliveredOrders).toBe(
      (await listOrders({ status: "delivered", limit: 5000 })).length,
    );
    expect(dashboard.deliveredMonthOrders).toBeLessThanOrEqual(
      dashboard.deliveredOrders,
    );
  });

  it("weighs what is still waiting on a gadi", async () => {
    const dashboard = await getDashboard("2026-07-03", "2026-07-01", "2026-07-31");
    const waiting = await listOrdersWithLines({ status: "to-deliver", limit: 5000 });
    const kg = waiting.reduce(
      (sum, o) => sum + o.lines.reduce((n, l) => n + l.qty, 0),
      0,
    );
    expect(dashboard.pendingOrders).toBe(waiting.length);
    expect(dashboard.toDeliverKg).toBeCloseTo(kg, 2);
  });

  it("ranks parties by the weight they took, not the bill", async () => {
    const parties = await topParties("2026-07-01", "2026-07-31", 5);
    expect(parties.length).toBeGreaterThan(0);
    expect(parties[0]?.kg).toBeGreaterThan(0);
    const weights = parties.map((p) => p.kg);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it("ranks the items that actually moved", async () => {
    const items = await topItems("2026-07-01", "2026-07-31", 3);
    expect(items[0]?.name).toBe("Biji VK");
    expect(items[0]?.kg).toBeGreaterThan(1000);
  });

  it("attributes orders to the broker who brought them", async () => {
    const brokers = await brokerSummary("2026-07-01", "2026-07-31");
    expect(brokers.map((b) => b.name)).toContain("rajesh");
  });
});

describe("parties", () => {
  it("shows each party what they owe", async () => {
    const parties = await listPartiesWithBalance();
    const owing = parties.filter((p) => p.balance > 0);
    expect(owing.length).toBeGreaterThan(0);
    expect(parties.every((p) => p.orderCount >= 0)).toBe(true);
  });

  it("renames a party across their open orders", async () => {
    const party = (await listParties()).find((p) => p.name === "J. M. Rewa")!;
    await saveParty({ id: party.id, name: "J. M. Rewa (new shop)" });
    const orders = await listOrders({ partyId: party.id });
    expect(orders.every((o) => o.partyName === "J. M. Rewa (new shop)")).toBe(true);
  });

  it("refuses to delete a party who has orders", async () => {
    const party = (await listParties()).find((p) => p.name.startsWith("J. M."))!;
    const result = await deleteParty(party.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/order/);
  });

  it("deletes a party with no history", async () => {
    const id = await saveParty({ name: "Walk-in", phone: "9000000000" });
    expect((await deleteParty(id)).ok).toBe(true);
  });
});

describe("deleting an order", () => {
  it("takes its lines with it", async () => {
    const db = await getDb();
    const order = (await listOrders())[0]!;
    await deleteOrder(order.id);
    expect(await getOrder(order.id)).toBeNull();
    const orphans = await db.getAllAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM order_lines WHERE order_id = ?",
      [order.id],
    );
    expect(orphans[0]?.n).toBe(0);
  });
});

describe("items", () => {
  it("keeps the name on past bills when an item is deleted", async () => {
    const id = await saveItem({ name: "Test Masala", defaultRate: 200, kgPerBag: 25 });
    const party = (await listParties())[0]!;
    const orderId = await saveOrder({
      partyId: party.id,
      partyName: party.name,
      brokerId: null,
      brokerName: null,
      date: "2026-07-05",
      status: "delivered",
      note: null,
      discount: 0,
      received: 0,
      lines: [{ itemId: id, itemName: "Test Masala", bags: 1, qty: 25, rate: 200 }],
    });
    const { deleteItem } = await import("../src/db/queries");
    await deleteItem(id);
    const order = await getOrder(orderId);
    expect(order?.lines[0]?.itemName).toBe("Test Masala");
    expect(order?.lines[0]?.itemId).toBeNull();
  });
});

describe("export", () => {
  it("turns the book into a CSV with a row per line", async () => {
    const orders = await listOrdersWithLines({ from: "2026-07-01", to: "2026-07-31" });
    const csv = ordersToCsv(orders);
    const rows = csv.split("\r\n");
    const lineCount = orders.reduce((n, o) => n + Math.max(o.lines.length, 1), 0);
    expect(rows).toHaveLength(lineCount + 1);
    expect(rows[0]).toContain("Party Name");
  });
});

describe("backup and restore", () => {
  it("puts the whole book back exactly as it was", async () => {
    const before = await exportBackup();
    const ordersBefore = (await listOrders()).length;

    const party = (await listParties())[0]!;
    await saveOrder({
      partyId: party.id,
      partyName: party.name,
      brokerId: null,
      brokerName: null,
      date: "2026-08-01",
      status: "pending",
      note: "written after the backup",
      discount: 0,
      received: 0,
      lines: [{ itemId: null, itemName: "Haldi", bags: 1, qty: 30, rate: 150 }],
    });
    expect((await listOrders()).length).toBe(ordersBefore + 1);

    const result = await restoreBackup(JSON.stringify(before));
    expect(result.orders).toBe(ordersBefore);
    expect((await listOrders()).length).toBe(ordersBefore);
  });

  it("refuses a file that is not a backup", async () => {
    await expect(restoreBackup('{"hello":"world"}')).rejects.toThrow(
      /not an M.L Orders backup/,
    );
  });
});

describe("starting over", () => {
  it("empties the book and seeds the catalogue again", async () => {
    await resetDb();
    expect(await listOrders()).toHaveLength(0);
    expect((await listItems()).length).toBeGreaterThan(0);
    expect((await listParties()).length).toBe(14);
    await saveBroker({ name: "new broker", commissionPct: 1.5 });
    expect((await listBrokers()).map((b) => b.name)).toContain("new broker");
  });
});


describe("upgrading an existing shop's database", () => {
  it("adds the challan tables without touching what is already written", async () => {
    // A phone that installed the app before challans existed: schema 1, with
    // a party and an order already in it.
    const old = await openDatabaseAsync();
    const first = MIGRATIONS[0];
    if (!first) throw new Error("migration 1 missing");
    await old.execAsync(first);
    await old.execAsync("PRAGMA user_version = 1");
    await old.runAsync(
      `INSERT INTO parties (id, name, phone, address, note, created_at, updated_at)
       VALUES ('p_old', 'Old Party', '9000000000', NULL, NULL, 'x', 'x')`,
    );
    await old.runAsync(
      `INSERT INTO orders (id, order_no, party_id, party_name, broker_id, broker_name,
                           date, status, note, subtotal, discount, total, received, balance,
                           created_at, updated_at)
       VALUES ('o_old', 'ORD-2026-0001', 'p_old', 'Old Party', NULL, NULL,
               '2026-07-01', 'delivered', NULL, 100, 0, 100, 0, 100, 'x', 'x')`,
    );

    await migrate(old as never);

    const version = await old.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version",
    );
    expect(version?.user_version).toBe(MIGRATIONS.length);

    const orders = await old.getAllAsync("SELECT * FROM orders");
    const parties = await old.getAllAsync("SELECT * FROM parties");
    expect(orders).toHaveLength(1);
    expect(parties).toHaveLength(1);

    // And the new tables are there to be written to.
    const challans = await old.getAllAsync("SELECT * FROM challans");
    const transporters = await old.getAllAsync("SELECT * FROM transporters");
    expect(challans).toHaveLength(0);
    expect(transporters).toHaveLength(0);
  });

  it("is safe to run again on a database already at the latest version", async () => {
    const db = await getDb();
    const before = (await listOrders()).length;
    await migrate(db as never);
    expect((await listOrders()).length).toBe(before);
  });
});

describe("challans", () => {
  it("takes every detail from the order, with nothing typed twice", async () => {
    const party = (await listParties())[0]!;
    await saveParty({ id: party.id, name: party.name, address: "Sidhi" });

    const transporterId = await saveTransporter({
      name: "Sharma Roadways",
      phone: "9820000000",
    });

    const orderId = await saveOrder({
      partyId: party.id,
      partyName: party.name,
      brokerId: null,
      brokerName: null,
      date: "2026-07-10",
      status: "packed",
      note: "25 kg lot",
      transporterId,
      transporterName: "Sharma Roadways",
      vehicleNo: "MP 17 AB 1234",
      discount: 0,
      received: 0,
      lines: [{ itemId: null, itemName: "Biji Safed", bags: 5, qty: 250, rate: 115 }],
    });

    const challan = await issueChallan(orderId);
    expect(challan.challanNo).toBe("CH-2026-0001");
    // Every one of these came off the order or the party, not a form.
    expect(challan.transporterName).toBe("Sharma Roadways");
    expect(challan.transporterPhone).toBe("9820000000");
    expect(challan.vehicleNo).toBe("MP 17 AB 1234");
    expect(challan.destination).toBe("Sidhi");
    expect(challan.note).toBe("25 kg lot");
    // The transport copy carries no prices.
    expect(challan.showRates).toBe(false);
  });

  it("keeps its number when it is printed again", async () => {
    const orders = await listOrders({ from: "2026-07-10", to: "2026-07-10" });
    const target = orders[0]!;
    const first = await getChallanForOrder(target.id);

    const again = await issueChallan(target.id);
    expect(again.id).toBe(first!.id);
    expect(again.challanNo).toBe(first!.challanNo);
  });

  it("picks up a change to the gadi made on the order", async () => {
    const orders = await listOrders({ from: "2026-07-10", to: "2026-07-10" });
    const target = await getOrder(orders[0]!.id);

    await saveOrder({
      id: target!.id,
      partyId: target!.partyId,
      partyName: target!.partyName,
      brokerId: null,
      brokerName: null,
      date: target!.date,
      status: target!.status,
      note: target!.note,
      transporterId: null,
      transporterName: "Satya Bhai Transport",
      vehicleNo: "MP 09 ZZ 9999",
      discount: 0,
      received: 0,
      lines: target!.lines.map((l) => ({
        itemId: l.itemId,
        itemName: l.itemName,
        bags: l.bags,
        qty: l.qty,
        rate: l.rate,
      })),
    });

    const reissued = await issueChallan(target!.id);
    expect(reissued.vehicleNo).toBe("MP 09 ZZ 9999");
    expect(reissued.transporterName).toBe("Satya Bhai Transport");
    expect(reissued.challanNo).toBe("CH-2026-0001");
  });

  it("gives the next order its own challan number", async () => {
    const party = (await listParties())[1]!;
    const orderId = await saveOrder({
      partyId: party.id,
      partyName: party.name,
      brokerId: null,
      brokerName: null,
      date: "2026-07-11",
      status: "packed",
      note: null,
      discount: 0,
      received: 0,
      lines: [{ itemId: null, itemName: "Haldi", bags: 1, qty: 30, rate: 148 }],
    });
    const challan = await issueChallan(orderId);
    expect(challan.challanNo).toBe("CH-2026-0002");
    // An order with no lorry arranged yet still gets its paper.
    expect(challan.vehicleNo).toBeNull();
  });

  it("goes with the order when the order is deleted", async () => {
    const party = (await listParties())[2]!;
    const orderId = await saveOrder({
      partyId: party.id,
      partyName: party.name,
      brokerId: null,
      brokerName: null,
      date: "2026-07-12",
      status: "packed",
      note: null,
      discount: 0,
      received: 0,
      lines: [{ itemId: null, itemName: "Dhaniya", bags: 1, qty: 30, rate: 165 }],
    });
    await issueChallan(orderId);
    expect(await getChallanForOrder(orderId)).not.toBeNull();

    await deleteOrder(orderId);
    expect(await getChallanForOrder(orderId)).toBeNull();
  });

  it("refuses to issue one for an order that is not there", async () => {
    await expect(issueChallan("nope")).rejects.toThrow(/could not be found/);
  });

  it("can be torn up without touching the order", async () => {
    const orders = await listOrders({ from: "2026-07-11", to: "2026-07-11" });
    const target = orders[0]!;
    const challan = await getChallanForOrder(target.id);
    expect(challan).not.toBeNull();

    await deleteChallan(challan!.id);
    expect(await getChallanForOrder(target.id)).toBeNull();
    expect(await getOrder(target.id)).not.toBeNull();
  });
});
