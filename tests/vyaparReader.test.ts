import { rmSync } from "fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readVyaparExtract } from "../src/lib/sync/vyaparReader";
import { unpackVyb, cleanupExtractDir } from "../src/lib/sync/unpackVyb";
import type { VyaparExtract } from "../src/lib/sync/types";
import { makeFixtureVyb } from "./fixtures/makeVyb";
import { readFileSync } from "fs";

// Every assertion here corresponds to a bug that reached production. If one
// of these fails, the dues numbers on the dashboard are wrong.

describe("vyaparReader", () => {
  let extract: VyaparExtract;
  let fixtureDir: string;

  beforeAll(() => {
    const { vybPath, dir } = makeFixtureVyb();
    fixtureDir = dir;
    const { vypPath, extractDir } = unpackVyb(readFileSync(vybPath));
    extract = readVyaparExtract(vypPath);
    cleanupExtractDir(extractDir);
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("reads every party", () => {
    expect(extract.customers).toHaveLength(4);
    expect(extract.customers.map((c) => c.name).sort()).toEqual([
      "Anil Shop",
      "Priya Traders",
      "Ramesh Kirana",
      "Suresh Stores",
    ]);
  });

  it("takes each party's balance from kb_names.amount, not from summing invoices", () => {
    // Ramesh's invoices total 9000 and his stale invoice balances also total
    // 9000, but Vyapar says he owes 5000. The 5000 must win - trusting the
    // invoice column is exactly what made the dashboard read ~10x too high.
    const ramesh = extract.customers.find((c) => c.name === "Ramesh Kirana")!;
    expect(ramesh.currentBalance).toBe(5000);

    const rameshInvoiceTotal = extract.invoices
      .filter((i) => i.customerExternalId === ramesh.externalId && i.type === "SALE")
      .reduce((s, i) => s + i.totalAmount, 0);
    expect(rameshInvoiceTotal).toBe(9000);
    expect(ramesh.currentBalance).not.toBe(rameshInvoiceTotal);
  });

  it("values a credit sale from its line items, never from txn_cash_amount", () => {
    // Every sale in the fixture has txn_cash_amount = 0 (they're on credit).
    // Resolving the total from that column zeroed out real debt.
    const sales = extract.invoices.filter((i) => i.type === "SALE");
    expect(sales).toHaveLength(5);
    expect(sales.every((s) => s.totalAmount > 0)).toBe(true);
    expect(sales.find((s) => s.invoiceNumber === "INV-1002")!.totalAmount).toBe(4000);
  });

  it("resolves item names by joining kb_items (kb_lineitems has only item_id)", () => {
    // Looking for a name column on kb_lineitems threw and killed the sync.
    expect(extract.lineItems.length).toBeGreaterThan(0);
    expect(extract.lineItems.every((li) => li.itemName !== "Unknown item")).toBe(true);
    expect(extract.lineItems.map((li) => li.itemName)).toContain("Haldi 1kg");
    expect(extract.lineItems.map((li) => li.itemName)).toContain("Mirchi 1kg");
  });

  it("types a receivable opening balance and values it from the balance column", () => {
    // Opening balances have no line items and no cash - their amount is in
    // txn_balance_amount alone, so they used to be read as zero and vanish.
    const opening = extract.invoices.filter((i) => i.type === "OPENING_BALANCE");
    expect(opening).toHaveLength(1);
    expect(opening[0]!.totalAmount).toBe(2000);
  });

  it("classifies payments separately from sales", () => {
    const payments = extract.invoices.filter((i) => i.type === "PAYMENT_IN");
    expect(payments).toHaveLength(2);
    // A payment has no line items, so its amount does come from the cash column.
    expect(payments.map((p) => p.totalAmount).sort((a, b) => a - b)).toEqual([1200, 4000]);
  });

  it("reads the party group so broker attribution can work", () => {
    const ramesh = extract.customers.find((c) => c.name === "Ramesh Kirana")!;
    const suresh = extract.customers.find((c) => c.name === "Suresh Stores")!;
    const priya = extract.customers.find((c) => c.name === "Priya Traders")!;
    expect(ramesh.partyGroupName).toBe("Tota Brokar");
    expect(suresh.partyGroupName).toBe("MAUGANJ"); // a place, not a broker
    expect(priya.partyGroupName).toBeNull();
  });

  it("resolves inventory prices despite the _unit_ infix in the column names", () => {
    // item_sale_unit_price does not contain "sale_price", so a substring
    // match on the obvious name silently returned null for every item.
    expect(extract.inventoryItems).toHaveLength(2);
    expect(extract.inventoryItems.every((i) => i.salePrice !== null)).toBe(true);
    expect(extract.inventoryItems.every((i) => i.purchasePrice !== null)).toBe(true);
    const haldi = extract.inventoryItems.find((i) => i.name === "Haldi 1kg")!;
    expect(haldi.salePrice).toBe(120);
    expect(haldi.purchasePrice).toBe(100);
  });

  it("keeps a missing phone number as null rather than an empty string", () => {
    const anil = extract.customers.find((c) => c.name === "Anil Shop")!;
    expect(anil.phone).toBeNull();
  });
});
