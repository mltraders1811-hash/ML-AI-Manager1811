import { describe, expect, it } from "vitest";

import {
  addDays,
  daysBetween,
  formatDate,
  monthRange,
  parseFlexibleDate,
  relativeDay,
  todayISO,
} from "../src/lib/date";

describe("formatDate", () => {
  it("shows a stored date the way a bill is read", () => {
    expect(formatDate("2026-07-03")).toBe("03/07/2026");
  });
});

describe("parseFlexibleDate", () => {
  it("accepts what gets typed", () => {
    expect(parseFlexibleDate("03/07/2026")).toBe("2026-07-03");
    expect(parseFlexibleDate("3-7-2026")).toBe("2026-07-03");
    expect(parseFlexibleDate("2026-07-03")).toBe("2026-07-03");
  });

  it("refuses a date that does not exist", () => {
    expect(parseFlexibleDate("31/02/2026")).toBeNull();
    expect(parseFlexibleDate("tomorrow")).toBeNull();
    expect(parseFlexibleDate("03/07/26")).toBeNull();
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("monthRange", () => {
  it("covers the whole month, February included", () => {
    expect(monthRange("2026-07-15")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("relativeDay", () => {
  const now = new Date(2026, 6, 3);

  it("names the days worth naming", () => {
    expect(relativeDay("2026-07-03", now)).toBe("Today");
    expect(relativeDay("2026-07-02", now)).toBe("Yesterday");
    expect(relativeDay("2026-07-01", now)).toBe("01/07/2026");
  });
});

describe("daysBetween", () => {
  it("counts days across a month end", () => {
    expect(daysBetween("2026-06-28", "2026-07-03")).toBe(5);
  });
});

describe("todayISO", () => {
  it("uses the phone's own day, not UTC", () => {
    // 23:30 local on the 3rd is the 3rd, even where that is already the 4th
    // in UTC - an order written at night belongs to the day it was written.
    expect(todayISO(new Date(2026, 6, 3, 23, 30))).toBe("2026-07-03");
  });
});
