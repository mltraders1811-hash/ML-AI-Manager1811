import { describe, expect, it } from "vitest";

import {
  A6_PAGE,
  bagWeight,
  buildChallanHtml,
  buildChallanMessage,
  challanFileName,
  escapeHtml,
  packingLabel,
  type ChallanDoc,
} from "../src/lib/challan";
import { nextChallanNo, nextDocNo } from "../src/lib/order";
import type { Challan, OrderWithLines, Party, ShopProfile } from "../src/lib/types";

const order: OrderWithLines = {
  id: "o1",
  orderNo: "ORD-2026-0012",
  partyId: "p1",
  partyName: "Anil pan masala, Rewa",
  brokerId: null,
  brokerName: "rajesh",
  date: "2026-07-02",
  status: "packed",
  note: null,
  subtotal: 202_050,
  discount: 0,
  total: 202_050,
  received: 0,
  balance: 202_050,
  createdAt: "",
  updatedAt: "",
  lines: [
    { id: "l1", orderId: "o1", itemId: "i1", itemName: "Biji VK", bags: 25, qty: 750, rate: 138, amount: 103_500, position: 0 },
    { id: "l2", orderId: "o1", itemId: "i2", itemName: "Biji 30 kg", bags: 10, qty: 300, rate: 121.5, amount: 36_450, position: 1 },
  ],
};

const party: Party = {
  id: "p1",
  name: "Anil pan masala, Rewa",
  phone: "8319741238",
  address: "Rewa",
  note: null,
  createdAt: "",
  updatedAt: "",
};

const shop: ShopProfile = {
  name: "M.L Traders",
  address: "Main market, Satna",
  phone: "9300000000",
  gstin: "23ABCDE1234F1Z5",
};

const challan: Challan = {
  id: "c1",
  challanNo: "CH-2026-0003",
  orderId: "o1",
  date: "2026-07-03",
  transporterId: "t1",
  transporterName: "Sharma Roadways",
  transporterPhone: "9820000000",
  vehicleNo: "MP 17 AB 1234",
  driverName: "Ramesh",
  driverPhone: "9812345678",
  lrNo: "LR-5512",
  destination: "Rewa",
  note: "Load on the evening truck",
  showRates: true,
  createdAt: "",
  updatedAt: "",
};

const doc: ChallanDoc = { challan, order, party, shop };

describe("escapeHtml", () => {
  it("keeps a party's own name from breaking the document", () => {
    expect(escapeHtml("Sharma & Sons <Rewa>")).toBe(
      "Sharma &amp; Sons &lt;Rewa&gt;",
    );
  });

  it("neutralises anything that would close a tag or an attribute", () => {
    expect(escapeHtml('" onload="x')).toBe("&quot; onload=&quot;x");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("treats a missing value as empty rather than the word null", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("A6_PAGE", () => {
  it("is A6 in points, which is what expo-print measures a page in", () => {
    // 105mm x 148mm at 72 PPI. Passed on every print call because the
    // default is US Letter and CSS @page size does not override it.
    expect(A6_PAGE.width).toBe(Math.round((105 / 25.4) * 72));
    expect(A6_PAGE.height).toBe(Math.round((148 / 25.4) * 72));
  });
});

describe("packing", () => {
  it("reads a line the way it is written by hand: bags of a size", () => {
    // "10 Bag Biji 50kg" is ten bags of fifty kilos, not fifty between them.
    const line = { ...order.lines[0]!, bags: 10, qty: 500 };
    expect(bagWeight(line)).toBe(50);
    expect(packingLabel(line)).toBe("10 bag · 50 kg");
  });

  it("rounds to the size the bag is sold as, not the scale reading", () => {
    // 8 bags came to 239.9 kg; the bag is still a 30 kg bag.
    const line = { ...order.lines[0]!, bags: 8, qty: 239.9 };
    expect(bagWeight(line)).toBe(30);
    expect(packingLabel(line)).toBe("8 bag · 30 kg");
  });

  it("says only the weight for goods not sold in bags", () => {
    const loose = { ...order.lines[0]!, bags: null, qty: 42.5 };
    expect(bagWeight(loose)).toBeNull();
    expect(packingLabel(loose)).toBe("42.5 kg");
  });
});

describe("buildChallanHtml", () => {
  const html = buildChallanHtml(doc);

  it("is a whole printable document on A6", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@page { size: A6 portrait");
    // Margins are the body's, not the page's: @page margin support differs
    // between print paths, body padding does not.
    expect(html).toContain("@page { size: A6 portrait; margin: 0; }");
    expect(html).toContain("padding: 5mm");
  });

  it("prints two copies, one per page, the way the pad is used", () => {
    expect(html).toContain("Transporter copy");
    expect(html).toContain("Office copy");
    expect(html).toContain("page-break-before: always");
    // The transporter signs one and it comes back to the shop.
    expect(html).toContain("sign and return");
    expect(html.match(/Transporter's signature/g)).toHaveLength(2);
  });

  it("stays a delivery note, not a tax document", () => {
    // Nothing on it that belongs on a GST invoice.
    expect(html).not.toContain("GSTIN");
    expect(html).not.toContain("23ABCDE1234F1Z5");
    expect(html).not.toContain("Consignee");
  });

  it("counts the load in nag, which is what comes off the lorry", () => {
    expect(html).toContain("<td>नग</td>");
  });

  it("reaches a Devanagari face before a Latin-only one", () => {
    // Item names get written in Hindi; a Latin-only stack prints boxes.
    expect(html).toContain("Noto Sans Devanagari");
  });

  it("prints a Hindi item name as itself", () => {
    const hindi = buildChallanHtml({
      ...doc,
      order: {
        ...order,
        lines: [{ ...order.lines[0]!, itemName: "बीजी" }],
      },
    });
    expect(hindi).toContain("बीजी");
  });

  it("carries what the gateman checks, on one line", () => {
    expect(html).toContain("CH-2026-0003");
    expect(html).toContain("Sharma Roadways &middot; MP 17 AB 1234 &middot; LR LR-5512 &middot; Ramesh 9812345678");
  });

  it("leaves out the parts of the lorry line nobody filled in", () => {
    const bare = buildChallanHtml({
      ...doc,
      challan: { ...challan, lrNo: null, driverName: null, driverPhone: null },
    });
    expect(bare).toContain("Sharma Roadways &middot; MP 17 AB 1234<");
    expect(bare).not.toContain("LR ");
  });

  it("totals the bags and the weight, not just the money", () => {
    expect(html).toContain('<td class="bags">35</td>');
    expect(html).toContain('<td class="num">1,050</td>');
  });

  it("puts the packing beside the item, the way it is written by hand", () => {
    // "Biji VK 30 kg" - the bag size, next to the name.
    expect(html).toContain('Biji VK <span class="pack">30 kg</span>');
  });

  it("names the shop, and nothing more about it", () => {
    expect(html).toContain("M.L Traders");
    expect(html).not.toContain("Main market, Satna");
  });

  it("leaves rates off when the transport copy should not carry prices", () => {
    const quiet = buildChallanHtml({
      ...doc,
      challan: { ...challan, showRates: false },
    });
    expect(quiet).not.toContain("Amount");
    expect(quiet).not.toContain("2,02,050");
    // The goods themselves still have to be listed and counted.
    expect(quiet).toContain("Biji VK");
    expect(quiet).toContain("1,050");
    expect(quiet).toContain("<td>नग</td>");
  });

  it("escapes the party name rather than pasting it in raw", () => {
    const nasty = buildChallanHtml({
      ...doc,
      order: { ...order, partyName: "Sharma & Sons <b>" },
    });
    expect(nasty).toContain("Sharma &amp; Sons &lt;b&gt;");
    expect(nasty).not.toContain("Sons <b>");
  });

  it("says nothing about a destination that was not given", () => {
    const bare = buildChallanHtml({
      ...doc,
      challan: { ...challan, destination: null },
    });
    expect(bare).not.toContain('class="dest"');
  });

  it("still prints when an order somehow has no lines", () => {
    const empty = buildChallanHtml({ ...doc, order: { ...order, lines: [] } });
    expect(empty).toContain("No items");
  });
});

describe("buildChallanMessage", () => {
  const message = buildChallanMessage(doc);

  it("leads with the shop, the challan and where it is going", () => {
    expect(message.startsWith("M.L Traders - Delivery Challan CH-2026-0003")).toBe(true);
    expect(message).toContain("To: Anil pan masala, Rewa");
    expect(message).toContain("Vehicle: MP 17 AB 1234");
    expect(message).toContain("Driver: Ramesh (9812345678)");
  });

  it("lists the load in bags and kilos, never in rupees", () => {
    expect(message).toContain("Biji VK: 25 bag · 30 kg = 750 kg");
    expect(message).toContain("Total: 35 nag, 1,050 kg");
    expect(message).not.toContain("₹");
  });

  it("says nothing about a vehicle that has not been given one", () => {
    const bare = buildChallanMessage({
      ...doc,
      challan: { ...challan, vehicleNo: null, driverName: null, lrNo: null },
    });
    expect(bare).not.toContain("Vehicle:");
    expect(bare).not.toContain("Driver:");
    expect(bare).not.toContain("LR:");
  });
});

describe("challan numbering", () => {
  it("runs its own series, separate from orders", () => {
    expect(nextChallanNo(null, "2026-07-03")).toBe("CH-2026-0001");
    expect(nextChallanNo("CH-2026-0009", "2026-07-03")).toBe("CH-2026-0010");
  });

  it("restarts when the year turns", () => {
    expect(nextChallanNo("CH-2026-0240", "2027-01-01")).toBe("CH-2027-0001");
  });

  it("does not continue an order number by mistake", () => {
    expect(nextChallanNo("ORD-2026-0012", "2026-07-03")).toBe("CH-2026-0001");
    expect(nextDocNo("ORD", "CH-2026-0012", "2026-07-03")).toBe("ORD-2026-0001");
  });
});

describe("challanFileName", () => {
  it("makes a document number safe to use as a file name", () => {
    expect(challanFileName("CH-2026-0003")).toBe("challan-CH-2026-0003.pdf");
    expect(challanFileName("CH/2026 03")).toBe("challan-CH-2026-03.pdf");
  });
});
