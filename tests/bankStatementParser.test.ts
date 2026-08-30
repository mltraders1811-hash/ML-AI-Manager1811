import { describe, expect, it } from "vitest";

import {
  detectDelimiter,
  fingerprint,
  parseAmountCell,
  parseDelimited,
  parseStatementDate,
  parseStatementGrid,
  withOccurrences,
} from "../src/lib/bank/statementParser";
import { StatementParseError } from "../src/lib/bank/types";

// No database and no files: these are the real-world statement layouts the
// parser has to survive, expressed directly.

function parseCsv(content: string) {
  return parseStatementGrid(parseDelimited(content, detectDelimiter(content)), "statement.csv");
}

describe("statement dates", () => {
  it("reads Indian day-first dates", () => {
    expect(parseStatementDate("05/08/2026")?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(parseStatementDate("5-8-26")?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("reads the named-month and ISO forms banks also use", () => {
    expect(parseStatementDate("05-Aug-26")?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(parseStatementDate("2026-08-05")?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("falls back to month-first only when day-first is impossible", () => {
    expect(parseStatementDate("08/25/2026")?.toISOString()).toBe("2026-08-25T00:00:00.000Z");
  });

  it("ignores a time of day and rejects impossible dates", () => {
    expect(parseStatementDate("05/08/2026 14:32:11")?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("closing balance")).toBeNull();
  });
});

describe("amount cells", () => {
  it("strips grouping, currency marks and Cr/Dr flags", () => {
    expect(parseAmountCell("1,24,500.50")).toEqual({ value: 124500.5, hint: null });
    expect(parseAmountCell("₹ 4,500.00")).toEqual({ value: 4500, hint: null });
    expect(parseAmountCell("4,500.00 Cr")).toEqual({ value: 4500, hint: "CREDIT" });
    expect(parseAmountCell("4500.00 Dr")).toEqual({ value: 4500, hint: "DEBIT" });
  });

  it("treats bracketed and negative figures as money out", () => {
    expect(parseAmountCell("(4,500.00)")).toEqual({ value: 4500, hint: "DEBIT" });
    expect(parseAmountCell(-4500)).toEqual({ value: 4500, hint: "DEBIT" });
  });

  it("returns null for anything that isn't a figure", () => {
    expect(parseAmountCell("")).toBeNull();
    expect(parseAmountCell("N/A")).toBeNull();
  });
});

describe("HDFC-style export (separate withdrawal/deposit columns)", () => {
  const csv = [
    "Account Statement",
    "Account No :XXXXXXXX4471   Statement of account",
    "",
    "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
    "05/08/2026,UPI/CR/451203377421/SHARMA TRAD/HDFC/Payment,451203377421,05/08/2026,,25000.00,325000.00",
    "06/08/2026,NEFT DR-UTIB0000123-SUPPLIER CO,N1234,06/08/2026,12000.00,,313000.00",
    "07/08/2026,BRN-CLG-CHQ PAID,000456,07/08/2026,5000.00,,308000.00",
    "",
    "",
    "",
    "*This is a computer generated statement",
  ].join("\n");

  it("reads every line with the right direction", () => {
    const parsed = parseCsv(csv);
    expect(parsed.transactions).toHaveLength(3);
    expect(parsed.transactions[0]).toMatchObject({ direction: "CREDIT", amount: 25000, balanceAfter: 325000 });
    expect(parsed.transactions[1]).toMatchObject({ direction: "DEBIT", amount: 12000 });
    expect(parsed.transactions[0]!.description).toContain("SHARMA TRAD");
    expect(parsed.transactions[0]!.reference).toBe("451203377421");
  });

  it("picks up the account and the period from the file itself", () => {
    const parsed = parseCsv(csv);
    expect(parsed.account.accountLast4).toBe("4471");
    expect(parsed.periodStart?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(parsed.periodEnd?.toISOString()).toBe("2026-08-07T00:00:00.000Z");
  });

  it("names the bank from the downloaded file's own name", () => {
    const grid = parseDelimited(csv, detectDelimiter(csv));
    expect(parseStatementGrid(grid, "HDFC-Statement-Aug2026.csv").account.bankName).toBe("HDFC");
  });

  it("does not mistake the value-date column for the transaction date", () => {
    const parsed = parseCsv(csv);
    expect(parsed.transactions[0]!.valueDate?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });
});

describe("other bank layouts", () => {
  it("reads a single Amount column with a separate Dr/Cr flag", () => {
    const parsed = parseCsv(
      [
        "Date;Transaction Details;Reference;Amount;Dr / Cr;Balance",
        "05-Aug-2026;UPI IN/VERMA AGENCY;UPI4512;18,000.00;CR;2,18,000.00",
        "06-Aug-2026;RENT PAYMENT;NEFT991;30,000.00;DR;1,88,000.00",
      ].join("\n"),
    );
    expect(parsed.transactions.map((t) => t.direction)).toEqual(["CREDIT", "DEBIT"]);
    expect(parsed.transactions[0]!.amount).toBe(18000);
  });

  it("reads Debit/Credit headings and a narration containing commas", () => {
    const parsed = parseCsv(
      [
        "Txn Date,Value Date,Description,Ref No,Debit,Credit,Balance",
        '05/08/2026,05/08/2026,"IMPS/P2A/GUPTA STORES, KANPUR",512003,,9500.00,109500.00',
      ].join("\n"),
    );
    expect(parsed.transactions[0]).toMatchObject({ direction: "CREDIT", amount: 9500 });
    expect(parsed.transactions[0]!.description).toContain("GUPTA STORES, KANPUR");
  });

  it("reads a sheet-style grid with real Date and number cells", () => {
    const parsed = parseStatementGrid(
      [
        ["ICICI Bank Ltd", null, null, null],
        ["Date", "Narration", "Deposit", "Withdrawal"],
        [new Date(Date.UTC(2026, 7, 5)), "UPI/SHARMA TRADERS", 25000, null],
        [new Date(Date.UTC(2026, 7, 6)), "BANK CHARGES", null, 118],
      ],
      "icici.xlsx",
    );
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions[0]).toMatchObject({ direction: "CREDIT", amount: 25000 });
    expect(parsed.transactions[1]).toMatchObject({ direction: "DEBIT", amount: 118 });
    expect(parsed.account.bankName).toBe("ICICI");
  });
});

describe("unreadable files", () => {
  it("says what is missing rather than failing obscurely", () => {
    expect(() => parseCsv("hello there\nthis is not a statement")).toThrow(StatementParseError);
    expect(() => parseCsv("Date,Narration\n05/08/2026,Something")).toThrow(/amount column/i);
  });
});

describe("re-importing an overlapping statement", () => {
  const rows = [
    "Date,Narration,Deposit,Withdrawal",
    "05/08/2026,UPI/CR/SHARMA TRAD,5000.00,",
    "05/08/2026,UPI/CR/SHARMA TRAD,5000.00,",
    "06/08/2026,UPI/CR/VERMA AGENCY,7000.00,",
  ];

  it("gives identical lines on one day distinct identities", () => {
    const parsed = parseCsv(rows.join("\n"));
    const prints = withOccurrences(parsed.transactions).map(({ txn, occurrence }) =>
      fingerprint("acct-1", txn, occurrence),
    );
    expect(new Set(prints).size).toBe(3);
  });

  it("gives the same line the same identity in a later, longer statement", () => {
    const first = parseCsv(rows.join("\n"));
    const second = parseCsv([...rows, "07/08/2026,UPI/CR/NEW PARTY,1000.00,"].join("\n"));

    const printsOf = (txns: typeof first.transactions) =>
      withOccurrences(txns).map(({ txn, occurrence }) => fingerprint("acct-1", txn, occurrence));

    const before = printsOf(first.transactions);
    const after = printsOf(second.transactions);
    expect(after.slice(0, 3)).toEqual(before);
    expect(new Set(after).size).toBe(4);
  });

  it("keeps identities per account, so two banks never collide", () => {
    const parsed = parseCsv(rows.join("\n"));
    const txn = parsed.transactions[0]!;
    expect(fingerprint("acct-1", txn, 0)).not.toBe(fingerprint("acct-2", txn, 0));
  });
});

describe("delimiters", () => {
  it("detects semicolon and tab separated exports", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });

  it("does not let commas inside a quoted narration pick the delimiter", () => {
    expect(detectDelimiter('a;b\n"x, y, z";2')).toBe(";");
  });
});
