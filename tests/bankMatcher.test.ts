import { describe, expect, it } from "vitest";

import {
  AUTO_ASSIGN_CONFIDENCE,
  extractCounterparty,
  matchTransaction,
  nameSimilarity,
  nameTokens,
  type MatchCustomer,
} from "../src/lib/bank/matcher";

const customers: MatchCustomer[] = [
  { id: "c1", name: "Sharma Traders", phone: "9876543210", balance: 48000, recentBillAmounts: [25000, 23000] },
  { id: "c2", name: "Verma Agency", phone: null, balance: 12000, recentBillAmounts: [12000] },
  { id: "c3", name: "M/s Gupta Stores Pvt Ltd", phone: null, balance: 5000, recentBillAmounts: [] },
];

function match(description: string, amount = 1234, rules: { counterpartyKey: string; customerId: string; hits: number }[] = []) {
  return matchTransaction(
    { description, reference: null, amount, direction: "CREDIT" },
    { customers, rules },
  );
}

describe("pulling the payer out of a narration", () => {
  it("drops the rails, bank codes and reference numbers", () => {
    expect(extractCounterparty("UPI/CR/451203377421/SHARMA TRAD/HDFC/Payment").key).toBe("SHARMA TRAD");
    expect(extractCounterparty("NEFT-AXISP00234981-VERMA AGENCY-PAYMENT").key).toBe("VERMA AGENCY");
    expect(extractCounterparty("IMPS/P2A/512003/GUPTA STORES").key).toBe("GUPTA STORES");
  });

  it("uses the name half of a UPI handle", () => {
    expect(extractCounterparty("UPI/CR/9921/sharmatraders@okhdfcbank/HDFC").key).toBe("SHARMATRADERS");
  });

  it("returns nothing when the narration names no one", () => {
    expect(extractCounterparty("ATM CASH WDL 4471").key).toBeNull();
    expect(extractCounterparty("NEFT CR 00012345").key).toBeNull();
  });
});

describe("name similarity", () => {
  it("matches a truncated narration against the full name", () => {
    expect(nameSimilarity(nameTokens("SHARMA TRAD"), nameTokens("Sharma Traders"))).toBe(1);
  });

  it("matches a name written without spaces", () => {
    expect(nameSimilarity(nameTokens("SHARMATRADERS"), nameTokens("Sharma Traders"))).toBeGreaterThan(0.85);
  });

  it("ignores M/s, Pvt and Ltd on either side", () => {
    expect(nameSimilarity(nameTokens("GUPTA STORES"), nameTokens("M/s Gupta Stores Pvt Ltd"))).toBe(1);
  });

  it("does not match two different parties", () => {
    expect(nameSimilarity(nameTokens("VERMA AGENCY"), nameTokens("Sharma Traders"))).toBe(0);
  });
});

describe("suggesting a customer", () => {
  it("puts the named party first", () => {
    const outcome = match("UPI/CR/451203377421/SHARMA TRAD/HDFC/Payment");
    expect(outcome.suggestions[0]?.customerId).toBe("c1");
    expect(outcome.suggestions[0]?.reasons.join(" ")).toMatch(/narration/i);
  });

  it("suggests but does not decide on the name alone", () => {
    const outcome = match("UPI/CR/451203377421/SHARMA TRAD/HDFC/Payment");
    expect(outcome.auto).toBeNull();
    expect(outcome.suggestions[0]!.confidence).toBeLessThan(AUTO_ASSIGN_CONFIDENCE);
  });

  it("decides when the amount also matches one of their bills exactly", () => {
    const outcome = match("UPI/CR/451203377421/SHARMA TRAD/HDFC/Payment", 25000);
    expect(outcome.auto).toMatchObject({ customerId: "c1", source: "AUTO_NAME" });
    expect(outcome.suggestions[0]!.reasons.join(" ")).toMatch(/matches one of their recent bills/i);
  });

  it("applies a learnt rule on sight, whatever the amount", () => {
    const outcome = match("UPI/CR/9921/SHARMATRADERS@OKHDFCBANK/HDFC", 3333, [
      { counterpartyKey: "SHARMATRADERS", customerId: "c1", hits: 4 },
    ]);
    expect(outcome.auto).toMatchObject({ customerId: "c1", source: "AUTO_RULE" });
    expect(outcome.suggestions[0]!.reasons.join(" ")).toMatch(/4 times before/);
  });

  it("leaves an unrecognisable payer to a person", () => {
    const outcome = match("IMPS/P2A/8891/RAHUL KUMAR", 5000);
    expect(outcome.auto).toBeNull();
    expect(outcome.suggestions).toHaveLength(0);
    expect(outcome.counterpartyKey).toBe("RAHUL KUMAR");
  });

  it("refuses to decide between two similarly-named parties", () => {
    const twins: MatchCustomer[] = [
      { id: "a", name: "Sharma Traders", phone: null, balance: 9000, recentBillAmounts: [9000] },
      { id: "b", name: "Sharma Trading", phone: null, balance: 9000, recentBillAmounts: [9000] },
    ];
    const outcome = matchTransaction(
      { description: "UPI/CR/4512/SHARMA TRAD/HDFC", reference: null, amount: 9000, direction: "CREDIT" },
      { customers: twins, rules: [] },
    );
    expect(outcome.auto).toBeNull();
    expect(outcome.suggestions.map((s) => s.customerId).sort()).toEqual(["a", "b"]);
  });

  it("takes the payer's phone number in the narration as corroboration", () => {
    const outcome = match("UPI/CR/9876543210/SHARMA TRAD/HDFC", 4321);
    expect(outcome.suggestions[0]!.reasons.join(" ")).toMatch(/phone number/i);
    expect(outcome.auto).toMatchObject({ customerId: "c1" });
  });

  it("ignores an amount that happens to match when nobody is named", () => {
    const outcome = match("BANK CHARGES AUG", 12000);
    expect(outcome.suggestions).toHaveLength(0);
  });
});
