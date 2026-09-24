import { describe, expect, it } from "vitest";

import { formatINR, formatNumber, formatQty, parseAmount, round2 } from "../src/lib/money";

describe("round2", () => {
  it("rounds to paise", () => {
    expect(round2(28_308.199999999997)).toBe(28_308.2);
    expect(round2(1.005)).toBe(1.01);
  });

  it("turns nonsense into zero rather than passing NaN on", () => {
    expect(round2(Number.NaN)).toBe(0);
    expect(round2(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("parseAmount", () => {
  it("reads what a person types", () => {
    expect(parseAmount("1,250.5")).toBe(1250.5);
    expect(parseAmount("₹300")).toBe(300);
    expect(parseAmount("115")).toBe(115);
  });

  it("treats an empty or broken field as zero", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount("abc")).toBe(0);
    expect(parseAmount(".")).toBe(0);
  });
});

describe("formatINR", () => {
  it("groups the Indian way", () => {
    // 2,02,550 - not 202,550.
    expect(formatINR(202_550, { decimals: false })).toBe("₹2,02,550");
  });

  it("shows paise only when there are any", () => {
    expect(formatINR(7149)).toBe("₹7,149");
    expect(formatINR(28_308.2)).toBe("₹28,308.20");
  });
});

describe("formatNumber and formatQty", () => {
  it("drops trailing zeros on a weight", () => {
    expect(formatQty(250)).toBe("250");
    expect(formatQty(239.9)).toBe("239.9");
  });

  it("rounds a display figure without touching the stored one", () => {
    expect(formatNumber(1234.567, 0)).toBe("1,235");
  });
});
