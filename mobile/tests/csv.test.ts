import { describe, expect, it } from "vitest";

import { csvCell, csvFileName, ordersToCsv, toCsv } from "../src/lib/csv";
import { buildOrderMessage, telLink, waLink, waNumber } from "../src/lib/message";
import type { OrderWithLines } from "../src/lib/types";

const order: OrderWithLines = {
  id: "o1",
  orderNo: "ORD-2026-0012",
  partyId: "p1",
  partyName: "Anil pan masala, Rewa",
  brokerId: "b1",
  brokerName: "rajesh",
  date: "2026-07-02",
  status: "delivered",
  note: null,
  transporterId: null,
  transporterName: null,
  vehicleNo: null,
  subtotal: 202_050,
  discount: 0,
  total: 202_050,
  received: 50_000,
  balance: 152_050,
  createdAt: "",
  updatedAt: "",
  lines: [
    {
      id: "l1",
      orderId: "o1",
      itemId: "i1",
      itemName: "Biji VK",
      bags: 25,
      qty: 750,
      rate: 138,
      amount: 103_500,
      position: 0,
    },
    {
      id: "l2",
      orderId: "o1",
      itemId: "i2",
      itemName: "Biji 30 kg",
      bags: 10,
      qty: 300,
      rate: 121.5,
      amount: 36_450,
      position: 1,
    },
  ],
};

describe("csvCell", () => {
  it("quotes a cell that would otherwise split the row", () => {
    expect(csvCell("Anil pan masala, Rewa")).toBe('"Anil pan masala, Rewa"');
    expect(csvCell('He said "ok"')).toBe('"He said ""ok"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("leaves a plain cell alone and blanks a missing one", () => {
    expect(csvCell("Haldi")).toBe("Haldi");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF so quoted breaks survive Excel", () => {
    expect(toCsv([["a", "b"], [1, 2]])).toBe("a,b\r\n1,2");
  });
});

describe("ordersToCsv", () => {
  const csv = ordersToCsv([order]);
  const rows = csv.split("\r\n");

  it("writes one row per line, under one header", () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Order No");
  });

  it("puts the bill total on the first line only, so the column sums", () => {
    expect(rows[1]).toContain("202050");
    expect(rows[2]?.endsWith(",,,,,")).toBe(true);
  });

  it("still exports an order that has no lines", () => {
    const empty = ordersToCsv([{ ...order, lines: [] }]);
    expect(empty.split("\r\n")).toHaveLength(2);
  });
});

describe("csvFileName", () => {
  it("names the file after the period it covers", () => {
    expect(csvFileName("2026-07-01", "2026-07-31")).toBe(
      "orders_2026-07-01_to_2026-07-31.csv",
    );
  });
});

describe("waNumber", () => {
  it("puts the country code on an Indian mobile", () => {
    expect(waNumber("9893400064")).toBe("919893400064");
    expect(waNumber("09893400064")).toBe("919893400064");
    expect(waNumber("+91 98934 00064")).toBe("919893400064");
  });

  it("gives nothing back when there is nothing to dial", () => {
    expect(waNumber(null)).toBeNull();
    expect(waNumber("12345")).toBeNull();
  });
});

describe("waLink", () => {
  it("addresses the party when a number is known", () => {
    expect(waLink("9893400064", "hi")).toBe("https://wa.me/919893400064?text=hi");
  });

  it("falls back to WhatsApp's own picker when it is not", () => {
    expect(waLink(null, "hi")).toBe("https://wa.me/?text=hi");
  });
});

describe("telLink", () => {
  it("builds a dialable link or nothing at all", () => {
    expect(telLink("9893400064")).toBe("tel:9893400064");
    expect(telLink("")).toBeNull();
  });
});

describe("buildOrderMessage", () => {
  const message = buildOrderMessage(order, "M.L Traders");

  it("leads with the shop and the bill", () => {
    expect(message.startsWith("M.L Traders\nOrder ORD-2026-0012 - 02/07/2026")).toBe(
      true,
    );
  });

  it("spells out each line the way it was sold", () => {
    expect(message).toContain("Biji VK: 25 bag - 750 kg x ₹138 = ₹1,03,500");
  });

  it("ends on what is still owed", () => {
    expect(message).toContain("Total: ₹2,02,050");
    expect(message).toContain("Received: ₹50,000");
    expect(message).toContain("Balance: ₹1,52,050");
  });

  it("stays quiet about money that is not part of the deal", () => {
    const paid = buildOrderMessage(
      { ...order, received: 202_050, balance: 0 },
      "M.L Traders",
    );
    expect(paid).not.toContain("Balance:");
  });
});
