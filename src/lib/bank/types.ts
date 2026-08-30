// Shared shapes for the bank-reconciliation feature. Kept free of Prisma
// imports so the parser and the matcher stay pure and unit-testable.

export type BankDirection = "CREDIT" | "DEBIT";

/** One line of a bank statement, after parsing and before it is stored. */
export type ParsedBankTxn = {
  /** UTC midnight of the statement's calendar date. */
  date: Date;
  valueDate: Date | null;
  /** The narration exactly as the bank wrote it. */
  description: string;
  /** Cheque number / UTR / transaction id, when the statement has a column for it. */
  reference: string | null;
  direction: BankDirection;
  /** Always positive - `direction` carries the sign. */
  amount: number;
  balanceAfter: number | null;
  /** 1-based row in the source file, used in parse warnings. */
  rowNumber: number;
};

export type ParsedStatement = {
  transactions: ParsedBankTxn[];
  /** Whatever the file itself said about which account it is. */
  account: { bankName: string | null; accountLast4: string | null };
  periodStart: Date | null;
  periodEnd: Date | null;
  /** Rows that looked like data but could not be read. Shown, never thrown. */
  warnings: string[];
};

/** A statement we could not make sense of at all - always a 400, never a 500. */
export class StatementParseError extends Error {}

/** A spreadsheet/CSV cell, before any interpretation. */
export type Cell = string | number | Date | null;
