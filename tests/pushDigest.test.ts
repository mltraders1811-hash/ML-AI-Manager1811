import { describe, expect, it } from "vitest";

import { buildOverdueDigest, buildSyncFailureAlert, DIGEST_MIN_OVERDUE } from "../src/lib/pushDigest";
import type { OverdueCustomerDetail, OverdueResult } from "../src/lib/overdue";

function party(name: string, overdueAmount: number, maxDaysOverdue: number): OverdueCustomerDetail {
  return {
    customerId: `c-${name}`,
    party: name,
    phone: null,
    balance: overdueAmount,
    overdueAmount,
    upcomingAmount: 0,
    maxDaysOverdue,
    maxDaysSince: maxDaysOverdue,
    invoiceCount: 1,
    creditDays: 25,
    creditDaysCustom: false,
    invoices: [],
    reminderMessage: "",
    lastReminderAt: null,
    daysSinceReminder: null,
    reminderCount: 0,
    paidSinceReminder: null,
  };
}

function result(customers: OverdueCustomerDetail[]): OverdueResult {
  const totalOverdue = customers.reduce((s, c) => s + c.overdueAmount, 0);
  return {
    creditDays: 25,
    asOf: "2026-08-29",
    reminderTemplate: "",
    summary: { customerCount: customers.length, totalOverdue, totalOutstanding: totalOverdue },
    aging: [],
    customers,
  };
}

describe("the daily overdue digest", () => {
  it("stays silent when nobody is overdue", () => {
    expect(buildOverdueDigest(result([]))).toBeNull();
  });

  it("stays silent below the amount worth interrupting for", () => {
    // A notification that fires for pocket change trains you to ignore it.
    expect(buildOverdueDigest(result([party("Chhota", DIGEST_MIN_OVERDUE - 1, 40)]))).toBeNull();
    expect(buildOverdueDigest(result([party("Bada", DIGEST_MIN_OVERDUE, 40)]))).not.toBeNull();
  });

  it("leads with the total in the title", () => {
    const msg = buildOverdueDigest(result([party("Ramesh", 425000, 40)]))!;
    expect(msg.title).toBe("₹4,25,000 vasooli baaki");
  });

  it("names the biggest debtors, not whoever comes first in the list", () => {
    const msg = buildOverdueDigest(
      result([party("Small", 5000, 30), party("Huge", 900000, 30), party("Medium", 50000, 30)]),
    )!;
    expect(msg.body).toContain("Huge ₹9,00,000 · Medium ₹50,000 · Small ₹5,000");
  });

  it("counts the parties it had no room to name", () => {
    const msg = buildOverdueDigest(
      result([1, 2, 3, 4, 5, 6].map((n) => party(`P${n}`, n * 1000, 30))),
    )!;
    expect(msg.body).toContain("+3 aur");
  });

  it("reports the oldest debt, since that is what decides urgency", () => {
    const msg = buildOverdueDigest(result([party("A", 50000, 12), party("B", 20000, 143)]))!;
    expect(msg.body).toContain("Sabse purana 143 din.");
    expect(msg.body).toContain("2 party 25 din se upar.");
  });

  it("sends a tap straight to the overdue screen", () => {
    expect(buildOverdueDigest(result([party("A", 50000, 12)]))!.url).toBe("/overdue");
  });

  it("ignores parties whose money is not yet past its credit period", () => {
    // Their balance still counts as outstanding, but nothing about it is
    // overdue, so naming them in an overdue alert would be wrong.
    const upcoming = { ...party("Not due yet", 0, 0), balance: 80000, upcomingAmount: 80000 };
    const msg = buildOverdueDigest(result([party("Overdue", 60000, 30), upcoming]))!;
    expect(msg.body).not.toContain("Not due yet");
  });
});

describe("the sync failure alert", () => {
  it("says the numbers are stale, not just that something broke", () => {
    const msg = buildSyncFailureAlert("No backup file found in the Drive folder");
    expect(msg.body).toContain("purane numbers");
    expect(msg.body).toContain("No backup file found");
  });

  it("truncates a stack-trace-length reason rather than shipping it whole", () => {
    const msg = buildSyncFailureAlert("x".repeat(500));
    expect(msg.body.length).toBeLessThan(220);
    expect(msg.body).toContain("...");
  });

  it("uses its own tag so it does not replace the overdue digest", () => {
    expect(buildSyncFailureAlert("boom").tag).not.toBe(
      buildOverdueDigest(result([party("A", 50000, 12)]))!.tag,
    );
  });
});
