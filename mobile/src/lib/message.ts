import { formatDate } from "./date";
import { formatINR, formatQty } from "./money";
import type { OrderWithLines } from "./types";

/** The message that goes to the party on WhatsApp. Plain text, no markdown:
 *  asterisks render as bold in WhatsApp and as litter everywhere else, so the
 *  only formatting used is line breaks. */
export function buildOrderMessage(
  order: OrderWithLines,
  shopName: string,
): string {
  const lines: string[] = [];
  lines.push(`${shopName}`);
  lines.push(`Order ${order.orderNo} - ${formatDate(order.date)}`);
  lines.push(`Party: ${order.partyName}`);
  lines.push("");
  for (const line of order.lines) {
    const bags = line.bags ? `${formatQty(line.bags)} bag - ` : "";
    lines.push(
      `${line.itemName}: ${bags}${formatQty(line.qty)} kg x ${formatINR(line.rate)} = ${formatINR(line.amount)}`,
    );
  }
  lines.push("");
  if (order.discount > 0) {
    lines.push(`Subtotal: ${formatINR(order.subtotal)}`);
    lines.push(`Discount: ${formatINR(order.discount)}`);
  }
  lines.push(`Total: ${formatINR(order.total)}`);
  if (order.received > 0) lines.push(`Received: ${formatINR(order.received)}`);
  if (order.balance > 0) lines.push(`Balance: ${formatINR(order.balance)}`);
  if (order.note) {
    lines.push("");
    lines.push(order.note);
  }
  return lines.join("\n");
}

/** wa.me wants a bare country-coded number. Indian mobiles get 91 prefixed;
 *  anything already carrying a country code is left alone. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function waLink(phone: string | null | undefined, text: string): string {
  const number = waNumber(phone);
  const encoded = encodeURIComponent(text);
  // Without a number WhatsApp opens its own contact picker, which is still
  // better than doing nothing when a party has no phone saved.
  return number
    ? `https://wa.me/${number}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
}

export function telLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : null;
}
