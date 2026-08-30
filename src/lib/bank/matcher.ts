// Works out whose payment a bank credit is.
//
// A bank narration is not a name. What actually arrives looks like
// "UPI/CR/451203377421/SHARMA TRAD/HDFC/sharmatraders@okhdfc/Payment" or
// "NEFT-AXISP00234981-VERMA AGENCY-PAYMENT" - the party's name is in
// there, abbreviated, surrounded by rails, bank codes, reference numbers
// and handles. This module strips all of that down to a counterparty, then
// scores it against the customer list.
//
// Three signals, in order of how much they are trusted:
//
//   1. A learnt rule. Once someone has said "this counterparty is Sharma
//      Traders", the same payer is recognised on sight ever after. This is
//      what makes month two of reconciling far quicker than month one.
//   2. The name in the narration. Matched token-wise and prefix-tolerant,
//      because banks truncate ("SHARMA TRAD") and drop spaces
//      ("SHARMATRADERS").
//   3. Corroboration: the payer's phone number in the narration, or an
//      amount that exactly settles one of that party's open invoices.
//
// Nothing here touches the database, so every rule above is unit-tested
// directly against real narration shapes - see tests/bankMatcher.test.ts.
import type { BankDirection } from "./types";

/** At or above this, the app assigns the payment itself. */
export const AUTO_ASSIGN_CONFIDENCE = 90;
/** At or above this, it is worth putting in front of a person as a guess. */
export const SUGGEST_CONFIDENCE = 45;
/** Two candidates this close together are a coin toss, never an auto-assign. */
const AMBIGUITY_MARGIN = 6;

// Payment rails, bank shorthand and statement filler. None of it is ever
// part of a party's name.
const NOISE_TOKENS = new Set([
  "UPI", "IMPS", "NEFT", "RTGS", "MMT", "ACH", "NACH", "ECS", "CLG", "CHQ", "CHEQUE", "CHQNO",
  "TRF", "TRANSFER", "TRANSFERRED", "BY", "TO", "FROM", "CR", "DR", "INF", "INB", "IB", "MB",
  "ATM", "POS", "EMI", "SI", "PAY", "PAYMENT", "PAYMENTS", "PMT", "CASH", "DEP", "DEPOSIT",
  "WDL", "WITHDRAWAL", "SAL", "REF", "REFNO", "RRN", "UTR", "BANK", "BANKING", "NETBANKING",
  "FT", "FUND", "FUNDS", "TXN", "TRANSACTION", "COLLECT", "COLLECTION", "SETTLEMENT", "SETL",
  "MERCHANT", "SELF", "OTHERS", "MISC", "GST", "TDS", "NA", "NIL", "OF", "FOR", "VIA", "THRU",
]);

// Bank identifiers, which show up both as words and as the first four
// letters of an IFSC code.
const BANK_TOKENS = new Set([
  "HDFC", "ICIC", "ICICI", "SBIN", "SBI", "UTIB", "AXIS", "KKBK", "KOTAK", "PUNB", "PNB",
  "BARB", "BOB", "CNRB", "CANARA", "IDIB", "IOBA", "YESB", "YES", "INDB", "INDUSIND", "IDFB",
  "IDFC", "FDRL", "FEDERAL", "RATN", "RBL", "BKID", "MAHB", "UBIN", "CBIN", "UCBA", "TMBL",
  "KVBL", "CIUB", "DCBL", "SIBL", "ESFB", "AUBL", "JSFB", "USFB", "PYTM", "PAYTM", "AIRP",
  "OKHDFCBANK", "OKAXIS", "OKICICI", "OKSBI", "YBL", "IBL", "AXL", "APL", "PTYES", "PTHDFC",
]);

// Dropped from both sides before comparing, so "M/S Sharma Traders Pvt
// Ltd" and "SHARMA TRADERS" are the same party.
const GENERIC_SUFFIXES = new Set([
  "PVT", "PRIVATE", "LTD", "LIMITED", "LLP", "CO", "COMPANY", "AND", "THE", "MS", "M/S",
  "MR", "MRS", "SHRI", "SMT", "SRI", "SH", "MESSRS", "INC",
]);

function stripHandle(token: string): string {
  // "sharmatraders@okhdfcbank" - the half before the @ is the payer's own
  // VPA, which is very often their name run together.
  const at = token.indexOf("@");
  return at > 0 ? token.slice(0, at) : token;
}

function tokenize(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9@&.\s]/g, " ")
    .split(/\s+/)
    .map(stripHandle)
    .map((t) => t.replace(/[.&]/g, ""))
    .filter(Boolean);
}

function isNoise(token: string): boolean {
  if (NOISE_TOKENS.has(token) || BANK_TOKENS.has(token)) return true;
  if (/\d/.test(token)) return true; // reference numbers, masked accounts, IFSC tails
  if (token.length < 2) return true;
  if (/^X+$/.test(token)) return true;
  return false;
}

/** A party's name reduced to the tokens worth comparing. */
export function nameTokens(value: string): string[] {
  return tokenize(value).filter((t) => !GENERIC_SUFFIXES.has(t) && t.length > 1);
}

/** The stable key a learnt rule is stored under. */
export function normalizeKey(value: string): string {
  return nameTokens(value).join(" ");
}

/**
 * Pulls the other party out of a narration. Returns null when nothing but
 * rails and reference numbers is left - a bank charge, an ATM withdrawal -
 * which is exactly the row that should go to a person rather than be
 * guessed at.
 */
export function extractCounterparty(description: string): { display: string | null; key: string | null } {
  const kept = tokenize(description).filter((t) => !isNoise(t));
  const meaningful = kept.filter((t) => !GENERIC_SUFFIXES.has(t));
  if (!meaningful.length) return { display: null, key: null };

  // Bank narrations are long; the name is always near the front of what is
  // left once the rails are gone. Six tokens is generous for a party name
  // and keeps trailing remarks ("PAYMENT FOR AUGUST BILL") out of the key.
  const display = meaningful.slice(0, 6).join(" ");
  return { display, key: display };
}

/** Prefix-tolerant, because banks truncate: "SHARMA TRAD" is "SHARMA TRADERS". */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 4 && longer.startsWith(shorter);
}

/**
 * 0-1 similarity between a narration counterparty and a customer name.
 * Coverage is measured against the shorter side, so a truncated narration
 * still scores full marks against the full name it abbreviates.
 */
export function nameSimilarity(counterpartyTokens: string[], customerTokens: string[]): number {
  if (!counterpartyTokens.length || !customerTokens.length) return 0;

  const unmatched = [...customerTokens];
  let matched = 0;
  for (const token of counterpartyTokens) {
    const idx = unmatched.findIndex((c) => tokensMatch(token, c));
    if (idx >= 0) {
      matched++;
      unmatched.splice(idx, 1);
    }
  }
  const coverage = matched / Math.min(counterpartyTokens.length, customerTokens.length);

  // Banks also strip the spaces out ("SHARMATRADERS"), which leaves nothing
  // for token matching to work with, so compare the run-together forms too.
  const joinedA = counterpartyTokens.join("");
  const joinedB = customerTokens.join("");
  let joined = 0;
  if (joinedA === joinedB) {
    joined = 1;
  } else if (joinedA.length >= 5 && joinedB.length >= 5) {
    if (joinedA.startsWith(joinedB) || joinedB.startsWith(joinedA)) joined = 0.9;
    else if (joinedA.includes(joinedB) || joinedB.includes(joinedA)) joined = 0.75;
  }

  return Math.max(coverage, joined);
}

export type MatchCustomer = {
  id: string;
  name: string;
  phone: string | null;
  /** What the party owes right now, per Vyapar. Only used to break ties. */
  balance: number;
  /** Totals of that party's recent bills, for exact-amount corroboration. */
  recentBillAmounts?: number[];
};

export type MatchRule = { counterpartyKey: string; customerId: string; hits: number };

export type MatchInput = {
  description: string;
  reference: string | null;
  amount: number;
  direction: BankDirection;
};

export type MatchSuggestion = {
  customerId: string;
  name: string;
  /** 0-100. */
  confidence: number;
  /** Plain-language why, shown under the suggestion chip on the phone. */
  reasons: string[];
};

export type MatchOutcome = {
  counterparty: string | null;
  counterpartyKey: string | null;
  suggestions: MatchSuggestion[];
  /** Set only when one candidate is far enough ahead to apply without asking. */
  auto: { customerId: string; confidence: number; source: "AUTO_RULE" | "AUTO_NAME" } | null;
};

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/** Amounts agree if they are within a rupee - statements round, UPI doesn't. */
function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < 1;
}

export function matchTransaction(
  input: MatchInput,
  context: { customers: MatchCustomer[]; rules: MatchRule[] },
): MatchOutcome {
  const { display, key } = extractCounterparty(input.description);
  const narrationDigits = digitsOf(`${input.description} ${input.reference ?? ""}`);

  const rule = key ? context.rules.find((r) => r.counterpartyKey === key) : undefined;
  const counterpartyTokens = key ? nameTokens(key) : [];

  const scored: MatchSuggestion[] = [];
  for (const customer of context.customers) {
    const reasons: string[] = [];
    let confidence = 0;

    if (rule && rule.customerId === customer.id) {
      confidence = 96;
      reasons.push(
        rule.hits > 1
          ? `Same payer assigned to them ${rule.hits} times before`
          : "Same payer assigned to them before",
      );
    }

    const similarity = nameSimilarity(counterpartyTokens, nameTokens(customer.name));
    if (similarity > 0) {
      // A perfect name match is strong but not certain on its own - two
      // parties can share a surname - so it lands just under the
      // auto-assign line and is pushed over it by corroboration below.
      const nameScore = Math.round(similarity * 88);
      if (nameScore > confidence) {
        confidence = nameScore;
        reasons.length = 0;
      }
      if (nameScore >= confidence) {
        reasons.push(similarity >= 0.99 ? "Bank narration names them" : "Bank narration looks like their name");
      }
    }

    if (confidence === 0) continue;

    const phoneDigits = customer.phone ? digitsOf(customer.phone) : "";
    if (phoneDigits.length >= 10 && narrationDigits.includes(phoneDigits.slice(-10))) {
      confidence += 10;
      reasons.push("Their phone number is in the narration");
    }

    if (input.direction === "CREDIT") {
      const exactBill = (customer.recentBillAmounts ?? []).some((amt) => sameAmount(amt, input.amount));
      if (exactBill) {
        confidence += 8;
        reasons.push("Amount matches one of their recent bills exactly");
      } else if (customer.balance > 0 && sameAmount(customer.balance, input.amount)) {
        confidence += 8;
        reasons.push("Amount is exactly their full outstanding");
      }
    }

    scored.push({ customerId: customer.id, name: customer.name, confidence: Math.min(100, confidence), reasons });
  }

  scored.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  const suggestions = scored.filter((s) => s.confidence >= SUGGEST_CONFIDENCE).slice(0, 3);

  const top = suggestions[0];
  const runnerUp = suggestions[1];
  let auto: MatchOutcome["auto"] = null;
  if (top && top.confidence >= AUTO_ASSIGN_CONFIDENCE) {
    const ambiguous = runnerUp !== undefined && top.confidence - runnerUp.confidence < AMBIGUITY_MARGIN;
    if (!ambiguous) {
      auto = {
        customerId: top.customerId,
        confidence: top.confidence,
        source: rule && rule.customerId === top.customerId ? "AUTO_RULE" : "AUTO_NAME",
      };
    }
  }

  return { counterparty: display, counterpartyKey: key, suggestions, auto };
}
