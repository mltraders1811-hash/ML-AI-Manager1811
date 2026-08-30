// Reads a bank's own SMS or email alert - the message the phone gets within
// seconds of a payment landing.
//
// This is the other way to "connect the bank", and the only one that needs
// nothing from the bank beyond what it already sends: an SMS forwarding app
// on the phone posts each message to the ingest webhook, and a credit
// becomes a line on the Bank screen while the customer is still standing
// there. No Drive folder, no download, no waiting for the statement.
//
// The messages are short, and every bank words them differently, so this is
// deliberately conservative: anything it cannot read confidently is
// reported as unreadable and logged, never guessed into a receipt. A
// statement covering the same day supersedes whatever the alerts booked
// (see supersedeAlerts in importService.ts) - the bank's own file is the
// record; an alert is an early, provisional copy of one line of it.
import { extractCounterparty } from "./matcher";
import { detectBankName, parseAmountCell, parseStatementDate } from "./statementParser";
import type { BankDirection } from "./types";

/** Sender ids as they appear on an Indian phone, e.g. "AD-HDFCBK". */
const SENDER_BANKS: [RegExp, string][] = [
  [/HDFC/i, "HDFC"],
  [/ICICI|ICICIB/i, "ICICI"],
  [/SBI|SBIINB|CBSSBI/i, "SBI"],
  [/AXIS|AXISBK/i, "Axis"],
  [/KOTAK|KOTAKB/i, "Kotak"],
  [/PNBSMS|PUNJAB/i, "PNB"],
  [/BOBTXN|BOBSMS|BARODA/i, "Bank of Baroda"],
  [/CANBNK|CANARA/i, "Canara"],
  [/UNIONB|UNIONBK/i, "Union Bank"],
  [/YESBNK/i, "Yes Bank"],
  [/IDFCFB/i, "IDFC"],
  [/INDUSB/i, "IndusInd"],
  [/FEDBNK/i, "Federal"],
  [/RBLBNK/i, "RBL"],
  [/IOBCHN/i, "Indian Bank"],
  [/UCOBNK/i, "UCO"],
  [/BOIIND/i, "Bank of India"],
];

// Messages that mention money but book nothing. A collect request is the
// dangerous one: it names a payer and an amount and has not been paid.
const NOT_A_TRANSACTION = [
  { re: /collect\s*request|requesting\s*money|has\s*requested|payment\s*request/i, why: "a collect request, not a payment" },
  { re: /\bOTP\b|one[\s-]*time\s*password|do not share/i, why: "an OTP message" },
  { re: /will\s*be\s*(?:debited|credited)|scheduled|due\s*on|mandate|auto\s*pay|e-?mandate/i, why: "about a future payment" },
  { re: /fail(?:ed|ure)|declined|unsuccessful|could not be processed|rejected/i, why: "a failed payment" },
  { re: /balance\s*(?:enquiry|inquiry)|avl\s*bal(?:ance)?\s*(?:in|is)\b(?![\s\S]*(?:credited|debited))/i, why: "a balance message" },
  { re: /statement|cheque\s*book|debit\s*card\s*(?:applied|dispatch)|kyc|minimum\s*balance/i, why: "not a transaction message" },
];

const CREDIT_WORDS = /\b(credited|deposited|received|added to|has been credited)\b/i;
const DEBIT_WORDS = /\b(debited|withdrawn|spent|paid to|transferred to|debit)\b/i;

export type ParsedAlert = {
  date: Date;
  direction: BankDirection;
  amount: number;
  accountLast4: string | null;
  bankName: string | null;
  /** The payer as the message names them, before normalisation. */
  counterparty: string | null;
  counterpartyKey: string | null;
  reference: string | null;
  balanceAfter: number | null;
  /** The message itself, tidied - what the Bank screen shows as the narration. */
  description: string;
};

export type AlertParseResult = { ok: true; alert: ParsedAlert } | { ok: false; reason: string };

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The transaction amount, which is rarely the only figure in the message -
 * "Avl Bal INR 3,25,000" sits right beside it. Any figure introduced as a
 * balance or a limit is skipped.
 */
function findAmount(text: string): { value: number; index: number } | null {
  const re = /(?:rs|inr|₹)\.?\s*([\d,]+(?:\.\d{1,2})?)/gi;
  for (const match of text.matchAll(re)) {
    const before = text.slice(Math.max(0, match.index - 22), match.index).toLowerCase();
    if (/bal|balance|limit|avl|available|outstanding/.test(before)) continue;
    const parsed = parseAmountCell(match[1]!);
    if (parsed && parsed.value > 0) return { value: parsed.value, index: match.index };
  }
  return null;
}

function findBalance(text: string): number | null {
  const m = text.match(/(?:avl|available|avlbl|clsg|closing)?\s*bal(?:ance)?[:\s]*(?:is\s*)?(?:rs|inr|₹)?\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!m) return null;
  const parsed = parseAmountCell(m[1]!);
  return parsed ? parsed.value : null;
}

/** The last four digits of the account the message is about. */
export function findAccountLast4(text: string): string | null {
  const patterns = [
    /a\/?c(?:count)?\.?\s*(?:no\.?|number)?\s*[:\-]?\s*[x*]*(\d{3,6})/i,
    /acct\.?\s*[:\-]?\s*[x*]*(\d{3,6})/i,
    /\b[x*]{1,}(\d{3,6})\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1]!.slice(-4);
  }
  return null;
}

function findDate(text: string): Date | null {
  const patterns = [
    /\bon\s+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i,
    /\bon\s+(\d{1,2}[-\s]?[A-Za-z]{3}[-\s]?\d{2,4})/i,
    /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/,
    /\b(\d{1,2}[-\s]?[A-Za-z]{3}[-\s]?\d{2,4})\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    // "05Aug26" and "05-AUG-26" both have to reach the date reader as
    // something it recognises.
    const normalized = m[1]!.replace(/^(\d{1,2})[-\s]?([A-Za-z]{3})[-\s]?(\d{2,4})$/, "$1-$2-$3");
    const date = parseStatementDate(normalized);
    if (date) return date;
  }
  return null;
}

function findReference(text: string): string | null {
  const patterns = [
    /(?:upi|imps|neft|rtgs|txn|transaction)?\s*ref(?:erence)?\s*(?:no\.?|number|id)?\s*[:\-]?\s*([A-Za-z0-9]{6,25})/i,
    /\bUPI[:\s\/-]+(\d{9,20})/i,
    /\b(\d{12,20})\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1]!;
  }
  return null;
}

/**
 * The other party. Banks introduce them a dozen ways ("by a/c linked to VPA
 * x@y", "from SHARMA TRADERS", "Info- UPI/P2A/451203377/SHARMA TRAD"), so
 * each shape is tried in turn and whatever it yields goes through the same
 * narration cleaner the statement reader uses.
 */
function findCounterparty(text: string): { display: string | null; key: string | null } {
  const stop = "(?=\\s*[\\(\\.,;]|\\s+on\\b|\\s+ref\\b|\\s+upi\\b|\\s+avl\\b|\\s+bal\\b|\\s+info\\b|$)";
  const patterns: { re: RegExp; whole?: boolean }[] = [
    { re: /\bby\s+a\/?c\s+linked\s+to\s+vpa\s+([^\s,;()]+)/gi },
    { re: /\b(?:from|by|to)\s+vpa\s+([^\s,;()]+)/gi },
    { re: new RegExp(`\\b(?:trf\\s+)?from\\s+([A-Za-z0-9@._&'\\- ]{3,45}?)${stop}`, "gi") },
    { re: new RegExp(`\\bby\\s+([A-Za-z0-9@._&'\\- ]{3,45}?)${stop}`, "gi") },
    { re: new RegExp(`\\bto\\s+([A-Za-z0-9@._&'\\- ]{3,45}?)${stop}`, "gi") },
    // Axis and HDFC put the whole rail string in an "Info" tail.
    { re: /\binfo[:\-]\s*([^.]{3,60})/gi },
    { re: /\bfor\s+(?:NEFT|IMPS|RTGS|UPI)[^.]{3,60}/gi, whole: true },
  ];

  for (const { re, whole } of patterns) {
    // Every occurrence, not just the first: "credited by Rs.5000 ... by
    // Sharma traders" introduces the amount and the payer with the same
    // word, and only the second one is a name.
    for (const match of text.matchAll(re)) {
      const segment = whole ? match[0]! : match[1]!;
      const extracted = extractCounterparty(segment);
      if (extracted.key) return extracted;
    }
  }
  return { display: null, key: null };
}

/**
 * Reads one alert. `receivedAt` is only a fallback for the date: a message
 * that says when the payment happened is always believed over when the
 * message arrived.
 */
export function parseBankAlert(rawText: string, opts: { sender?: string | null; receivedAt?: Date } = {}): AlertParseResult {
  const text = tidy(rawText);
  if (text.length < 15) return { ok: false, reason: "Message too short to be a bank alert" };

  for (const { re, why } of NOT_A_TRANSACTION) {
    if (re.test(text)) return { ok: false, reason: `Ignored - ${why}` };
  }

  const amount = findAmount(text);
  if (!amount) return { ok: false, reason: "No amount found in the message" };

  const creditAt = text.search(CREDIT_WORDS);
  const debitAt = text.search(DEBIT_WORDS);
  if (creditAt === -1 && debitAt === -1) {
    return { ok: false, reason: "Message doesn't say whether money came in or went out" };
  }
  // Both words can appear ("debited from your a/c and credited to the
  // beneficiary"); the one stated first is the one about this account.
  const direction: BankDirection =
    creditAt !== -1 && (debitAt === -1 || creditAt < debitAt) ? "CREDIT" : "DEBIT";

  const counterparty = findCounterparty(text);

  return {
    ok: true,
    alert: {
      date: findDate(text) ?? opts.receivedAt ?? new Date(),
      direction,
      amount: amount.value,
      accountLast4: findAccountLast4(text),
      bankName: detectBankName(text) ?? bankFromSender(opts.sender ?? null),
      counterparty: counterparty.display,
      counterpartyKey: counterparty.key,
      reference: findReference(text),
      balanceAfter: findBalance(text),
      description: text.slice(0, 300),
    },
  };
}

/** "AD-HDFCBK" is often the only thing that says which bank sent a message. */
export function bankFromSender(sender: string | null): string | null {
  if (!sender) return null;
  for (const [re, name] of SENDER_BANKS) {
    if (re.test(sender)) return name;
  }
  return null;
}
