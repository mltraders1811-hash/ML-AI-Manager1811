import { formatNumber, round2, parseAmount } from "./money";
import type {
  DraftLine,
  Order,
  OrderLine,
  OrderStatus,
  PaymentStatus,
} from "./types";

/** What a line is worth. Quantity is in kilos, rate is per kilo - bags are
 *  only ever a shortcut for filling the kilos in. */
export function lineAmount(qty: number, rate: number): number {
  return round2(qty * rate);
}

/** Bags -> kilos, the suggestion the form pre-fills. The real weight is
 *  whatever the scale said, so this is a starting point, not a rule. */
export function bagsToKg(bags: number, kgPerBag: number): number {
  return round2(bags * kgPerBag);
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  total: number;
  received: number;
  balance: number;
}

export function computeTotals(
  lines: { qty: number; rate: number }[],
  discount = 0,
  received = 0,
): OrderTotals {
  const subtotal = round2(
    lines.reduce((sum, l) => sum + lineAmount(l.qty, l.rate), 0),
  );
  const cappedDiscount = clamp(round2(discount), 0, subtotal);
  const total = round2(subtotal - cappedDiscount);
  // More money than the bill is a mis-key, not a credit note: it would turn
  // the party's outstanding negative and quietly hide real debt elsewhere.
  const cappedReceived = clamp(round2(received), 0, total);
  return {
    subtotal,
    discount: cappedDiscount,
    total,
    received: cappedReceived,
    balance: round2(total - cappedReceived),
  };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

export function paymentStatus(total: number, received: number): PaymentStatus {
  if (received <= 0) return "unpaid";
  // Anything under a rupee short is settled - nobody chases 40 paise.
  if (received >= total - 0.99) return "paid";
  return "partial";
}

/** Draft rows the user has actually filled in. A blank trailing row is how
 *  the form invites the next item, not an order line. */
export function usableLines(draft: DraftLine[]): DraftLine[] {
  return draft.filter((l) => {
    const qty = parseAmount(l.qty);
    const rate = parseAmount(l.rate);
    return l.itemName.trim().length > 0 && qty > 0 && rate > 0;
  });
}

export interface DraftValidation {
  ok: boolean;
  errors: string[];
}

export function validateDraft(input: {
  partyId: string | null;
  date: string;
  lines: DraftLine[];
}): DraftValidation {
  const errors: string[] = [];
  if (!input.partyId) errors.push("Choose a party.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) errors.push("Enter a valid date.");
  if (usableLines(input.lines).length === 0) {
    errors.push("Add at least one item with a quantity and rate.");
  }
  for (const line of input.lines) {
    const hasName = line.itemName.trim().length > 0;
    const qty = parseAmount(line.qty);
    const rate = parseAmount(line.rate);
    if (hasName && qty > 0 && rate <= 0) {
      errors.push(`Enter a rate for ${line.itemName.trim()}.`);
    }
    if (hasName && rate > 0 && qty <= 0) {
      errors.push(`Enter a quantity for ${line.itemName.trim()}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** ORD-2026-0007, CH-2026-0007: sortable, readable aloud down a phone line,
 *  and unique per year without needing a counter table. A number from another
 *  year, or one this app did not write, starts the series again at 1. */
export function nextDocNo(
  prefix: string,
  lastNo: string | null,
  date: string,
): string {
  const year = date.slice(0, 4);
  const match = lastNo?.match(new RegExp(`^${prefix}-(\\d{4})-(\\d+)$`));
  const next = match && match[1] === year ? Number(match[2]) + 1 : 1;
  return `${prefix}-${year}-${String(next).padStart(4, "0")}`;
}

export function nextOrderNo(lastOrderNo: string | null, date: string): string {
  return nextDocNo("ORD", lastOrderNo, date);
}

export function nextChallanNo(lastChallanNo: string | null, date: string): string {
  return nextDocNo("CH", lastChallanNo, date);
}

export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "packed":
      return "Packed";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
  }
}

export function paymentLabel(status: PaymentStatus): string {
  switch (status) {
    case "unpaid":
      return "Unpaid";
    case "partial":
      return "Part paid";
    case "paid":
      return "Paid";
  }
}

/** The next step in the shop's own sequence, for the one-tap button on the
 *  order screen. Delivered and cancelled orders have no next step. */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  switch (status) {
    case "pending":
      return "packed";
    case "packed":
      return "delivered";
    default:
      return null;
  }
}

/** Brokerage owed on an order, at the broker's own rate. Cancelled orders
 *  earn nobody anything. */
export function brokerage(order: Order, commissionPct: number): number {
  if (order.status === "cancelled") return 0;
  return round2((order.total * commissionPct) / 100);
}

export function orderKg(lines: OrderLine[]): number {
  return round2(lines.reduce((sum, l) => sum + l.qty, 0));
}

export function orderBags(lines: OrderLine[]): number {
  return round2(lines.reduce((sum, l) => sum + (l.bags ?? 0), 0));
}

/** What one line is sending, in the words used on the shop floor: bags if the
 *  line was written in bags, loose kilos otherwise. */
export function lineGoods(line: OrderLine): string {
  if (line.bags != null && line.bags > 0) {
    return `${line.itemName} ${formatNumber(line.bags, 0)} bag`;
  }
  return `${line.itemName} ${formatNumber(line.qty, 0)} kg`;
}

/** The goods on an order, short enough for a list row. */
export function goodsSummary(lines: OrderLine[], max = 2): string {
  if (lines.length === 0) return "No items";
  const shown = lines.slice(0, max).map(lineGoods).join(" · ");
  const rest = lines.length - max;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}
