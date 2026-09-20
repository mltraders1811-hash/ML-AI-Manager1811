import { beforeAll, describe, expect, it } from "vitest";

import { getDb, resetDb } from "../src/db";
import { loadSampleOrders, sampleOrdersLoaded } from "../src/db/seed";
import { exportBackup, restoreBackup } from "../src/db/backup";
import {
  addPayment,
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
