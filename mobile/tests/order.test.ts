import { describe, expect, it } from "vitest";

import {
  bagsToKg,
  brokerage,
  computeTotals,
  goodsSummary,
  lineAmount,
  lineGoods,
  nextOrderNo,
  nextStatus,
  orderBags,
  orderKg,
  paymentStatus,
  usableLines,
  validateDraft,
} from "../src/lib/order";
import type { DraftLine, Order, OrderLine } from "../src/lib/types";

const draft = (over: Partial<DraftLine> = {}): DraftLine => ({
  key: "k",
  itemId: null,
  itemName: "Biji Safed",
  bags: "",
  qty: "10",
  rate: "115",
  ...over,
});

describe("lineAmount", () => {
  it("multiplies weight by rate", () => {
    expect(lineAmount(250, 114)).toBe(28500);
  });

  it("rounds to paise instead of leaking float noise", () => {
    // 239.9 x 118 is 28308.199999999997 in binary floating point, and a bill
    // showing that is a bill nobody trusts.
    expect(lineAmount(239.9, 118)).toBe(28308.2);
    expect(lineAmount(751.3, 111.5)).toBe(83769.95);
  });
});

describe("bagsToKg", () => {
  it("suggests the standard bag weight", () => {
    expect(bagsToKg(8, 30)).toBe(240);
    expect(bagsToKg(2.5, 30)).toBe(75);
  });
});

describe("computeTotals", () => {
  it("adds the lines, takes the discount, leaves the balance", () => {
    const totals = computeTotals(
      [
        { qty: 750, rate: 138 },
        { qty: 450, rate: 138 },
        { qty: 300, rate: 121.5 },
      ],
      500,
      50_000,
    );
    expect(totals.subtotal).toBe(202_050);
    expect(totals.discount).toBe(500);
    expect(totals.total).toBe(201_550);
    expect(totals.received).toBe(50_000);
    expect(totals.balance).toBe(151_550);
  });

  it("never lets money received exceed the bill", () => {
    const totals = computeTotals([{ qty: 10, rate: 100 }], 0, 5000);
    expect(totals.received).toBe(1000);
    expect(totals.balance).toBe(0);
  });

  it("never lets a discount push the total below zero", () => {
    const totals = computeTotals([{ qty: 10, rate: 100 }], 99_999, 0);
    expect(totals.discount).toBe(1000);
    expect(totals.total).toBe(0);
  });

  it("treats an empty order as zero rather than NaN", () => {
    expect(computeTotals([], Number.NaN, Number.NaN)).toEqual({
      subtotal: 0,
      discount: 0,
      total: 0,
      received: 0,
      balance: 0,
    });
  });
});

describe("paymentStatus", () => {
  it("reads the money, not a stored flag", () => {
    expect(paymentStatus(1000, 0)).toBe("unpaid");
    expect(paymentStatus(1000, 400)).toBe("partial");
    expect(paymentStatus(1000, 1000)).toBe("paid");
  });

  it("calls a bill settled when only paise are short", () => {
    expect(paymentStatus(7149.4, 7149)).toBe("paid");
    expect(paymentStatus(7149, 7000)).toBe("partial");
  });
});

describe("usableLines and validateDraft", () => {
  it("ignores the blank row the form keeps at the end", () => {
    const lines = [draft(), draft({ key: "b", itemName: "", qty: "", rate: "" })];
    expect(usableLines(lines)).toHaveLength(1);
  });

  it("wants a party, a date and one real line", () => {
    expect(
      validateDraft({ partyId: null, date: "2026-07-03", lines: [draft()] }).errors,
    ).toContain("Choose a party.");
    expect(
      validateDraft({ partyId: "p1", date: "03-07-2026", lines: [draft()] }).ok,
    ).toBe(false);
    expect(
      validateDraft({ partyId: "p1", date: "2026-07-03", lines: [draft()] }).ok,
    ).toBe(true);
  });

  it("points at the half-filled line by name", () => {
    const result = validateDraft({
      partyId: "p1",
      date: "2026-07-03",
      lines: [draft(), draft({ key: "b", itemName: "Haldi", qty: "50", rate: "" })],
    });
    expect(result.errors).toContain("Enter a rate for Haldi.");
  });
});

describe("nextOrderNo", () => {
  it("starts at one in an empty book", () => {
    expect(nextOrderNo(null, "2026-07-03")).toBe("ORD-2026-0001");
  });

  it("counts on within the year", () => {
    expect(nextOrderNo("ORD-2026-0016", "2026-07-03")).toBe("ORD-2026-0017");
  });

  it("restarts when the year turns", () => {
    expect(nextOrderNo("ORD-2026-0240", "2027-01-01")).toBe("ORD-2027-0001");
  });

  it("does not trip over a number it cannot read", () => {
    expect(nextOrderNo("INV/7", "2026-07-03")).toBe("ORD-2026-0001");
  });
});

describe("nextStatus", () => {
  it("walks the shop's own sequence and then stops", () => {
    expect(nextStatus("pending")).toBe("packed");
    expect(nextStatus("packed")).toBe("delivered");
    expect(nextStatus("delivered")).toBeNull();
    expect(nextStatus("cancelled")).toBeNull();
  });
});

describe("brokerage", () => {
  const order = (over: Partial<Order> = {}): Order => ({
    id: "o1",
    orderNo: "ORD-2026-0001",
    partyId: "p1",
    partyName: "Jo.jo.",
    brokerId: "b1",
    brokerName: "jojo",
    date: "2026-07-03",
    status: "delivered",
    note: null,
    transporterId: null,
    transporterName: null,
    vehicleNo: null,
    subtotal: 28_308.2,
    discount: 0,
    total: 28_308.2,
    received: 0,
    balance: 28_308.2,
    createdAt: "",
    updatedAt: "",
    ...over,
  });

  it("is a percentage of the bill", () => {
    expect(brokerage(order(), 1)).toBe(283.08);
  });

  it("is nothing on a cancelled order", () => {
    expect(brokerage(order({ status: "cancelled" }), 1)).toBe(0);
  });
});

describe("order weights", () => {
  const line = (over: Partial<OrderLine>): OrderLine => ({
    id: "l",
    orderId: "o",
    itemId: null,
    itemName: "Biji",
    bags: 10,
    qty: 300,
    rate: 121,
    amount: 36_300,
    position: 0,
    ...over,
  });

  it("adds the kilos and the bags", () => {
    const lines = [line({}), line({ id: "l2", bags: 2, qty: 101.3 })];
    expect(orderKg(lines)).toBe(401.3);
    expect(orderBags(lines)).toBe(12);
  });

  it("counts a line with no bag figure as none", () => {
    expect(orderBags([line({ bags: null })])).toBe(0);
  });
});

describe("what is going out", () => {
  const line = (over: Partial<OrderLine>): OrderLine => ({
    id: "l",
    orderId: "o",
    itemId: null,
    itemName: "Biji",
    bags: 10,
    qty: 300,
    rate: 121,
    amount: 36_300,
    position: 0,
    ...over,
  });

  it("names a line in bags when it was written in bags", () => {
    expect(lineGoods(line({}))).toBe("Biji 10 bag");
  });

  it("falls back to loose kilos when there are no bags", () => {
    expect(lineGoods(line({ bags: null, qty: 47.5 }))).toBe("Biji 48 kg");
  });

  it("joins the first lines and counts the rest", () => {
    const lines = [
      line({}),
      line({ id: "l2", itemName: "Dhaniya", bags: 4 }),
      line({ id: "l3", itemName: "Saunf", bags: 2 }),
    ];
    expect(goodsSummary(lines)).toBe("Biji 10 bag · Dhaniya 4 bag +1 more");
    expect(goodsSummary(lines, 3)).toBe("Biji 10 bag · Dhaniya 4 bag · Saunf 2 bag");
  });

  it("says so when an order has nothing on it", () => {
    expect(goodsSummary([])).toBe("No items");
  });
});
