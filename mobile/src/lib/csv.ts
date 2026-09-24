import { formatDate } from "./date";
import type { OrderWithLines } from "./types";

/** RFC-4180 quoting. A party called `Sharma & Sons, Rewa` must not become two
 *  columns in whatever the accountant opens this in. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  // Excel needs \r\n to keep quoted line breaks inside one cell.
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** One row per order line, which is the shape that can be pivoted into
 *  anything else later - unlike one row per bill. */
export function ordersToCsv(orders: OrderWithLines[]): string {
  const header = [
    "Date",
    "Order No",
    "Party Name",
    "Phone",
    "Broker",
    "Item Name",
    "Bags",
    "Quantity",
    "Rate",
    "Amount",
    "Order Total",
    "Received",
    "Balance",
    "Status",
    "Note",
  ];
  const rows: unknown[][] = [header];
  for (const order of orders) {
    if (order.lines.length === 0) {
      rows.push([
        formatDate(order.date),
        order.orderNo,
        order.partyName,
        "",
        order.brokerName ?? "",
        "",
        "",
        "",
        "",
        "",
        order.total,
        order.received,
        order.balance,
        order.status,
        order.note ?? "",
      ]);
      continue;
    }
    order.lines.forEach((line, i) => {
      rows.push([
        formatDate(order.date),
        order.orderNo,
        order.partyName,
        "",
        order.brokerName ?? "",
        line.itemName,
        line.bags ?? "",
        line.qty,
        line.rate,
        line.amount,
        // Bill-level figures only on the first line, so summing the column
        // gives the real total instead of multiplying it by the line count.
        i === 0 ? order.total : "",
        i === 0 ? order.received : "",
        i === 0 ? order.balance : "",
        i === 0 ? order.status : "",
        i === 0 ? (order.note ?? "") : "",
      ]);
    });
  }
  return toCsv(rows);
}

export function csvFileName(from: string, to: string): string {
  return `orders_${from}_to_${to}.csv`;
}
