// Reads a bank statement file into plain transaction rows.
//
// There is no standard for this. Every Indian bank exports a different
// shape: HDFC writes "Withdrawal Amt."/"Deposit Amt.", SBI "Debit"/"Credit",
// Kotak a single "Amount" with a separate "Dr / Cr" flag; some put five
// rows of account blurb above the header, some quote every field, some end
// with a "computer generated statement" footer. Rather than one parser per
// bank (which breaks the first time a bank changes a label), this detects
// the header row and maps columns by keyword, the same approach the
// brokerage Sale Report parser already uses on Vyapar's exports.
//
// The grid-level entry point is pure, so the awkward real-world layouts can
// be covered by unit tests without a file or a database.
import { createHash } from "crypto";

import ExcelJS from "exceljs";

import type { BankDirection, Cell, ParsedBankTxn, ParsedStatement } from "./types";
import { StatementParseError } from "./types";

const HEADER_SCAN_ROWS = 40;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const BANK_NAMES = [
  "HDFC", "ICICI", "State Bank of India", "SBI", "Axis", "Kotak", "Punjab National", "PNB",
  "Bank of Baroda", "Canara", "Union Bank", "IDBI", "Yes Bank", "IndusInd", "IDFC", "Federal",
  "RBL", "Bandhan", "AU Small Finance", "Central Bank", "Indian Bank", "UCO", "Bank of India",
  "Bank of Maharashtra", "Karnataka Bank", "Karur Vysya", "City Union", "DCB", "Saraswat",
  "HSBC", "Citibank", "Standard Chartered", "DBS", "Paytm Payments", "Airtel Payments",
];

function text(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString();
  return String(cell).trim();
}

function isBlankRow(row: Cell[]): boolean {
  return row.every((c) => text(c) === "");
}

function utcMidnight(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null; // e.g. 31/02
  return d;
}

/**
 * Statement dates are calendar dates: "5 Aug" is 5 Aug whatever timezone
 * the server runs in, so they are stored as UTC midnight, matching how
 * invoice dates are handled (see src/lib/dateIst.ts).
 *
 * Day-first by default - every Indian bank writes DD/MM - but a first
 * number above 12 with a second one that isn't settles it either way, which
 * is what makes a US-ordered export readable too.
 */
export function parseStatementDate(cell: Cell): Date | null {
  if (cell instanceof Date) {
    return utcMidnight(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate());
  }
  if (typeof cell === "number") {
    // Excel serial day: day 1 is 1900-01-01, and the epoch is offset by two
    // because Excel believes 1900 was a leap year.
    if (!Number.isFinite(cell) || cell < 1 || cell > 100_000) return null;
    const ms = Math.round(cell - 25569) * 86_400_000;
    const d = new Date(ms);
    return utcMidnight(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const raw = text(cell);
  if (!raw) return null;
  // Drop any time-of-day the statement carries along with the date.
  const s = raw.split(/[ T]/)[0]!.trim() || raw.trim();

  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return utcMidnight(+iso[1]!, +iso[2]!, +iso[3]!);

  const numeric = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    let a = +numeric[1]!;
    let b = +numeric[2]!;
    let year = +numeric[3]!;
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (a <= 12 && b > 12) [a, b] = [b, a]; // MM/DD/YYYY export
    return utcMidnight(year, b, a);
  }

  const named = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/);
  if (named) {
    const month = MONTHS.indexOf(named[2]!.slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return null;
    let year = +named[3]!;
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return utcMidnight(year, month, +named[1]!);
  }

  return null;
}

/**
 * Reads an amount cell. Returns the sign hint separately: some statements
 * mark direction on the amount itself ("4,500.00 Cr", "(4,500.00)") rather
 * than in a column of its own.
 */
export function parseAmountCell(cell: Cell): { value: number; hint: BankDirection | null } | null {
  if (typeof cell === "number") {
    return Number.isFinite(cell) ? { value: Math.abs(cell), hint: cell < 0 ? "DEBIT" : null } : null;
  }
  const raw = text(cell);
  if (!raw) return null;

  let s = raw.replace(/[₹$]|(?:^|\s)(?:rs|inr)\.?(?=\s|\d)/gi, " ").trim();
  let hint: BankDirection | null = null;

  const marked = s.match(/\b(cr|dr)\b\.?\s*$/i) ?? s.match(/^\s*\b(cr|dr)\b\.?/i);
  if (marked) {
    hint = marked[1]!.toLowerCase() === "cr" ? "CREDIT" : "DEBIT";
    s = s.replace(marked[0]!, " ").trim();
  }

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (s.startsWith("+")) s = s.slice(1);

  s = s.replace(/[,\s]/g, "");
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const value = parseFloat(s);
  if (!Number.isFinite(value)) return null;
  if (negative && !hint) hint = "DEBIT";
  return { value, hint };
}

type ColumnMap = {
  date: number;
  valueDate: number | null;
  description: number[];
  reference: number | null;
  withdrawal: number | null;
  deposit: number | null;
  amount: number | null;
  drCr: number | null;
  balance: number | null;
};

function matches(header: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(header));
}

const DATE_PATTERNS = [/\bdate\b/, /^date/, /txn.*dt/, /\bdt\b/];
const VALUE_DATE_PATTERNS = [/value\s*date/, /value\s*dt/];
const DESCRIPTION_PATTERNS = [/narration/, /description/, /particular/, /remark/, /transaction\s*details/, /^details/, /^detail/];
const REFERENCE_PATTERNS = [/chq/, /cheque/, /\bref\b/, /reference/, /\butr\b/, /instrument/, /transaction\s*id/, /txn\s*id/];
const WITHDRAWAL_PATTERNS = [/withdraw/, /\bdebit\b/, /debit\s*amount/, /^dr\b/, /paid\s*out/, /\bdr\s*amount/];
const DEPOSIT_PATTERNS = [/deposit/, /\bcredit\b/, /credit\s*amount/, /^cr\b/, /paid\s*in/, /\bcr\s*amount/];
const AMOUNT_PATTERNS = [/^amount/, /\bamount\b/, /^amt/];
const DRCR_PATTERNS = [/dr\s*\/\s*cr/, /cr\s*\/\s*dr/, /dr\|cr/, /^type$/, /transaction\s*type/, /debit\s*\/\s*credit/];
const BALANCE_PATTERNS = [/balance/, /\bbal\b/];

/** How statement-header-like a row looks; the best-scoring row wins. */
function headerScore(cells: string[]): number {
  const hasDate = cells.some((h) => h && matches(h, DATE_PATTERNS));
  if (!hasDate) return 0;
  let score = 1;
  if (cells.some((h) => h && matches(h, DESCRIPTION_PATTERNS))) score += 2;
  if (cells.some((h) => h && matches(h, WITHDRAWAL_PATTERNS))) score += 1;
  if (cells.some((h) => h && matches(h, DEPOSIT_PATTERNS))) score += 1;
  if (cells.some((h) => h && matches(h, AMOUNT_PATTERNS))) score += 1;
  if (cells.some((h) => h && matches(h, BALANCE_PATTERNS))) score += 1;
  return score;
}

function mapColumns(headers: string[]): ColumnMap | null {
  const used = new Set<number>();
  const pick = (patterns: RegExp[]): number | null => {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i) || !headers[i]) continue;
      if (matches(headers[i]!, patterns)) {
        used.add(i);
        return i;
      }
    }
    return null;
  };

  // Value date first, so it can't be mistaken for the transaction date.
  const valueDate = pick(VALUE_DATE_PATTERNS);
  const date = pick(DATE_PATTERNS);
  if (date === null) {
    // A statement with only a value date still has a usable date.
    if (valueDate === null) return null;
    return {
      date: valueDate, valueDate: null, description: [], reference: null,
      withdrawal: null, deposit: null, amount: null, drCr: null, balance: null,
    };
  }

  // The Dr/Cr flag column is claimed before the withdrawal one: a heading
  // of "Dr / Cr" also matches the withdrawal patterns, and letting it be
  // read as an amount column makes every debit look like a credit.
  const drCr = pick(DRCR_PATTERNS);
  const reference = pick(REFERENCE_PATTERNS);
  const withdrawal = pick(WITHDRAWAL_PATTERNS);
  const deposit = pick(DEPOSIT_PATTERNS);
  const balance = pick(BALANCE_PATTERNS);
  const amount = pick(AMOUNT_PATTERNS);

  // Some exports split the narration over two or three adjacent columns
  // ("Description", "Transaction Remarks"). Take all of them.
  const description: number[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (used.has(i) || !headers[i]) continue;
    if (matches(headers[i]!, DESCRIPTION_PATTERNS)) description.push(i);
  }
  description.forEach((i) => used.add(i));

  return { date, valueDate, description, reference, withdrawal, deposit, amount, drCr, balance };
}

function joinDescription(row: Cell[], map: ColumnMap): string {
  if (map.description.length) {
    const parts = map.description.map((i) => text(row[i])).filter(Boolean);
    if (parts.length) return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  // No description column at all: fall back to the longest text cell that
  // isn't a number or the date, which is what the narration always is.
  let best = "";
  for (let i = 0; i < row.length; i++) {
    if (i === map.date || i === map.valueDate) continue;
    const t = text(row[i]);
    if (t.length > best.length && !/^[\d,.\-()₹\s]*$/.test(t)) best = t;
  }
  return best;
}

function directionOf(row: Cell[], map: ColumnMap): { direction: BankDirection; amount: number } | null {
  const withdrawal = map.withdrawal !== null ? parseAmountCell(row[map.withdrawal] ?? null) : null;
  const deposit = map.deposit !== null ? parseAmountCell(row[map.deposit] ?? null) : null;

  // Separate in/out columns: whichever one carries a non-zero figure.
  if (deposit && deposit.value > 0) return { direction: "CREDIT", amount: deposit.value };
  if (withdrawal && withdrawal.value > 0) return { direction: "DEBIT", amount: withdrawal.value };

  const amount = map.amount !== null ? parseAmountCell(row[map.amount] ?? null) : null;
  if (amount && amount.value > 0) {
    const flag = map.drCr !== null ? text(row[map.drCr]).toLowerCase() : "";
    if (/^cr|credit|^c$|deposit|received|in\b/.test(flag)) return { direction: "CREDIT", amount: amount.value };
    if (/^dr|debit|^d$|withdraw|paid|out\b/.test(flag)) return { direction: "DEBIT", amount: amount.value };
    // No flag column: the sign or a "Cr"/"Dr" on the figure itself decides.
    // A bare positive amount with neither is money in, which is the row a
    // reconciliation screen exists for.
    return { direction: amount.hint ?? "CREDIT", amount: amount.value };
  }

  return null;
}

function findAccountLast4(rows: Cell[][], headerRow: number): string | null {
  const limit = Math.min(headerRow + 1, rows.length);
  for (let r = 0; r < limit; r++) {
    const line = rows[r]!.map(text).filter(Boolean).join(" ");
    const m = line.match(/a(?:\/c|ccount)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([Xx*\d]{4,20})/i);
    if (m) {
      const digits = m[1]!.replace(/\D/g, "");
      if (digits.length >= 4) return digits.slice(-4);
    }
  }
  return null;
}

function findBankName(rows: Cell[][], headerRow: number, filename: string): string | null {
  const limit = Math.min(headerRow + 1, rows.length);
  const haystacks = [filename];
  for (let r = 0; r < limit; r++) haystacks.push(rows[r]!.map(text).filter(Boolean).join(" "));

  for (const hay of haystacks) {
    for (const bank of BANK_NAMES) {
      const re = new RegExp(`\\b${bank.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(hay)) return bank;
    }
  }
  return null;
}

/**
 * The pure core: a grid of cells in, transactions out. Everything
 * file-format-specific (CSV quoting, xlsx cell objects) is handled by the
 * callers below so that this - the part with all the real-world judgement
 * in it - can be tested directly.
 */
export function parseStatementGrid(grid: Cell[][], filename = ""): ParsedStatement {
  const rows = grid.filter((r) => r.length > 0);
  if (!rows.length) throw new StatementParseError("The statement file is empty");

  let headerRow = -1;
  let best = 0;
  let headers: string[] = [];
  const scanLimit = Math.min(HEADER_SCAN_ROWS, rows.length);
  for (let r = 0; r < scanLimit; r++) {
    const cells = rows[r]!.map((c) => text(c).toLowerCase().replace(/\s+/g, " "));
    const score = headerScore(cells);
    if (score > best) {
      best = score;
      headerRow = r;
      headers = cells;
    }
  }

  if (headerRow === -1) {
    throw new StatementParseError(
      "Couldn't find the column headings in this statement. Export it from your bank as CSV or Excel with the Date, Narration and amount columns included.",
    );
  }

  const map = mapColumns(headers);
  if (!map) {
    throw new StatementParseError("Couldn't find a date column in this statement");
  }
  if (map.withdrawal === null && map.deposit === null && map.amount === null) {
    throw new StatementParseError(
      "Couldn't find an amount column in this statement (looked for Amount, Deposit/Credit and Withdrawal/Debit)",
    );
  }

  const transactions: ParsedBankTxn[] = [];
  const warnings: string[] = [];
  let blankStreak = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (isBlankRow(row)) {
      blankStreak++;
      // A run of empty rows is where the table ends and the bank's footer
      // blurb begins; stopping there keeps "This is a computer generated
      // statement" out of the warnings.
      if (blankStreak >= 3) break;
      continue;
    }
    blankStreak = 0;

    const date = parseStatementDate(row[map.date] ?? null);
    if (!date) continue; // totals row, footer text, repeated header on page 2

    const money = directionOf(row, map);
    if (!money) {
      warnings.push(`Row ${r + 1}: no amount could be read, skipped`);
      continue;
    }

    const balanceCell = map.balance !== null ? parseAmountCell(row[map.balance] ?? null) : null;
    const reference = map.reference !== null ? text(row[map.reference]) || null : null;

    transactions.push({
      date,
      valueDate: map.valueDate !== null ? parseStatementDate(row[map.valueDate] ?? null) : null,
      description: joinDescription(row, map),
      reference,
      direction: money.direction,
      amount: money.amount,
      balanceAfter: balanceCell ? (balanceCell.hint === "DEBIT" ? -balanceCell.value : balanceCell.value) : null,
      rowNumber: r + 1,
    });
  }

  if (!transactions.length) {
    throw new StatementParseError("No transactions could be read from this statement");
  }

  const times = transactions.map((t) => t.date.getTime());
  return {
    transactions,
    account: {
      bankName: findBankName(rows, headerRow, filename),
      accountLast4: findAccountLast4(rows, headerRow),
    },
    periodStart: new Date(Math.min(...times)),
    periodEnd: new Date(Math.max(...times)),
    warnings,
  };
}

/** Minimal RFC4180 reader: quoted fields, embedded commas and newlines. */
export function parseDelimited(content: string, delimiter: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (quoted) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((c) => text(c) !== "")) rows.push(row);
  return rows;
}

/** Banks export "CSV" with commas, semicolons, tabs or pipes. Pick whichever
 * separates the file's lines most consistently. */
export function detectDelimiter(content: string): string {
  const lines = content.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  const candidates = [",", ";", "\t", "|"];
  let bestDelimiter = ",";
  let bestScore = -1;
  for (const d of candidates) {
    // Count outside quotes, so a narration containing a comma doesn't win it.
    const counts = lines.map((l) => l.split('"').filter((_, i) => i % 2 === 0).join("").split(d).length - 1);
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const max = Math.max(...counts);
    const consistent = counts.filter((c) => c === max && c > 0).length;
    const score = consistent * 10 + total;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = d;
    }
  }
  return bestDelimiter;
}

function cellFromExcel(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((r) => r.text).join("");
    if ("result" in value) return cellFromExcel(value.result as ExcelJS.CellValue);
    if ("text" in value && typeof (value as { text?: unknown }).text === "string") return (value as { text: string }).text;
  }
  return null;
}

async function gridFromXlsx(bytes: Buffer): Promise<Cell[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs
    // ships its own ambient Buffer type that cannot coexist with
    // @types/node's; see the same note in src/lib/brokerage/excelParser.ts.
    await workbook.xlsx.load(bytes as any);
  } catch (e) {
    throw new StatementParseError(`Couldn't read this Excel file: ${(e as Error).message}`);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new StatementParseError("The workbook has no sheets");

  const grid: Cell[][] = [];
  const width = Math.max(sheet.columnCount, 1);
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: Cell[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellFromExcel(row.getCell(c).value));
    grid.push(cells);
  }
  return grid;
}

/** Reads an uploaded or downloaded statement, choosing the reader by extension. */
export async function parseStatementFile(filename: string, bytes: Buffer): Promise<ParsedStatement> {
  if (bytes.length === 0) throw new StatementParseError("The statement file is empty");
  const lower = filename.toLowerCase();

  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    return parseStatementGrid(await gridFromXlsx(bytes), filename);
  }
  if (lower.endsWith(".xls")) {
    // Old-format .xls is a different binary container that exceljs can't
    // read. Banks all offer CSV, so say so rather than failing obscurely.
    throw new StatementParseError("Old .xls files aren't supported - download the statement as CSV or .xlsx instead");
  }
  if (lower.endsWith(".pdf")) {
    throw new StatementParseError("PDF statements can't be read - download the same statement as CSV or Excel from your bank");
  }

  const content = bytes.toString("utf8").replace(/^﻿/, "");
  return parseStatementGrid(parseDelimited(content, detectDelimiter(content)), filename);
}

/**
 * A stable identity for a statement line. Statements overlap constantly -
 * a monthly download repeats everything a weekly one already had - so
 * re-importing has to be a no-op rather than doubling the month's receipts.
 *
 * `occurrence` distinguishes genuinely identical lines on the same day (two
 * ₹5,000 UPI credits from the same payer). It is derived by counting
 * matching lines within the file, which is stable across re-imports as long
 * as the statement lists that day in full - which any statement covering
 * the day does.
 */
export function fingerprint(accountId: string, txn: ParsedBankTxn, occurrence: number): string {
  const key = [
    accountId,
    txn.date.toISOString().slice(0, 10),
    txn.direction,
    txn.amount.toFixed(2),
    txn.description.toUpperCase().replace(/\s+/g, " ").trim(),
    (txn.reference ?? "").toUpperCase().trim(),
    occurrence,
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/** Assigns each transaction its occurrence index within the file. */
export function withOccurrences(transactions: ParsedBankTxn[]): { txn: ParsedBankTxn; occurrence: number }[] {
  const seen = new Map<string, number>();
  return transactions.map((txn) => {
    const key = [
      txn.date.toISOString().slice(0, 10),
      txn.direction,
      txn.amount.toFixed(2),
      txn.description.toUpperCase().replace(/\s+/g, " ").trim(),
      (txn.reference ?? "").toUpperCase().trim(),
    ].join("|");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { txn, occurrence };
  });
}
