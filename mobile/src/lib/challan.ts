import { formatDate } from "./date";
import { formatINR, formatNumber, formatQty } from "./money";
import { orderBags, orderKg } from "./order";
import type { Challan, OrderLine, OrderWithLines, Party, ShopProfile } from "./types";

/** A6 in points at 72 PPI, which is the unit expo-print measures a page in.
 *  105mm x 148mm -> 105/25.4*72 = 297.6, 148/25.4*72 = 419.5. Without this
 *  expo-print lays the page out on US Letter (612x792) and the CSS @page size
 *  does not save it - the challan would print small in the corner of a big
 *  sheet. */
export const A6_PAGE = { width: 298, height: 420 } as const;

export interface ChallanDoc {
  challan: Challan;
  order: OrderWithLines;
  party: Party | null;
  shop: ShopProfile;
}

/** A party called `Sharma & Sons <Rewa>` must print as its own name, not
 *  break the document or inject markup into it. Everything that reaches the
 *  HTML goes through here. */
export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The packing size the shop writes on a challan - "10 Bag Biji 50kg" means
 *  ten bags of fifty kilos, not ten bags weighing fifty between them. Actual
 *  weighed totals are never exactly the nominal size (8 bags came to 239.9),
 *  so this rounds to the whole kilo the bag is sold as. */
export function bagWeight(line: OrderLine): number | null {
  if (!line.bags || line.bags <= 0 || line.qty <= 0) return null;
  return Math.round(line.qty / line.bags);
}

/** "10 bag · 50 kg" - the line as it is written by hand today. */
export function packingLabel(line: OrderLine): string {
  const per = bagWeight(line);
  if (!line.bags) return `${formatQty(line.qty)} kg`;
  return per
    ? `${formatQty(line.bags)} bag · ${formatNumber(per, 0)} kg`
    : `${formatQty(line.bags)} bag`;
}

/** One copy, one A6 page. Deliberately close to the handwritten pad: who it
 *  is for, where it is going, how many bags of what, the total in nag, and
 *  which lorry took it. Nothing else fits on A6 and nothing else is used. */
function copyBlock(doc: ChallanDoc, label: string, signNote: string): string {
  const { challan, order, shop } = doc;
  const showRates = challan.showRates;

  const rows = order.lines
    .map((line) => {
      const per = bagWeight(line);
      const cells = [
        `<td class="bags">${line.bags ? formatQty(line.bags) : "-"}</td>`,
        `<td>${escapeHtml(line.itemName)}${per ? ` <span class="pack">${formatNumber(per, 0)} kg</span>` : ""}</td>`,
        `<td class="num">${formatQty(line.qty)}</td>`,
      ];
      if (showRates) {
        cells.push(`<td class="num">${escapeHtml(formatINR(line.amount))}</td>`);
      }
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  const cols = showRates ? 4 : 3;
  const head = showRates
    ? "<th>Bags</th><th>Item</th><th>Kg</th><th>Amount</th>"
    : "<th>Bags</th><th>Item</th><th>Kg</th>";

  // The lorry, on one line, skipping whatever was not filled in.
  const transport = [
    challan.transporterName,
    challan.vehicleNo,
    challan.lrNo ? `LR ${challan.lrNo}` : null,
    challan.driverName
      ? `${challan.driverName}${challan.driverPhone ? ` ${challan.driverPhone}` : ""}`
      : null,
  ]
    .filter((part) => (part ?? "").trim().length > 0)
    .map((part) => escapeHtml(part))
    .join(" &middot; ");

  return `
  <section class="copy">
    <div class="top">
      <div class="shop">${escapeHtml(shop.name)}</div>
      <div class="doc">
        <div>${escapeHtml(challan.challanNo)}</div>
        <div>${escapeHtml(formatDate(challan.date))}</div>
      </div>
    </div>

    <div class="to">
      <div class="party">${escapeHtml(order.partyName)}</div>
      ${challan.destination ? `<div class="dest">${escapeHtml(challan.destination)}</div>` : ""}
    </div>

    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>
        ${rows || `<tr><td colspan="${cols}">No items</td></tr>`}
        <tr class="total">
          <td class="bags">${formatQty(orderBags(order.lines))}</td>
          <td>नग</td>
          <td class="num">${formatQty(orderKg(order.lines))}</td>
          ${showRates ? `<td class="num">${escapeHtml(formatINR(order.total))}</td>` : ""}
        </tr>
      </tbody>
    </table>

    ${transport ? `<div class="transport">${transport}</div>` : ""}
    ${challan.note ? `<div class="note">${escapeHtml(challan.note)}</div>` : ""}

    <div class="sign">
      <div class="line">Transporter's signature</div>
      <div class="tag">${escapeHtml(label)} &middot; ${escapeHtml(signNote)}</div>
    </div>
  </section>`;
}

/** The printable challan: two A6 copies, one per page. The lorry takes the
 *  first and signs the second, which comes back to the shop - which is how
 *  the handwritten pad is already used. */
export function buildChallanHtml(doc: ChallanDoc): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Challan ${escapeHtml(doc.challan.challanNo)}</title>
<style>
  @page { size: A6 portrait; margin: 0; }
  * { box-sizing: border-box; }
  /* Item names get written in Hindi, so the stack has to reach a Devanagari
     face before it falls back to a Latin-only one and prints boxes. */
  body { margin: 0; padding: 5mm; color: #111; font-size: 9pt;
         font-family: "Noto Sans Devanagari", "Noto Sans", Roboto, "Segoe UI", Arial, sans-serif; }
  .copy { padding: 0; }
  /* Each copy is its own page, so nothing has to be cut to size. */
  .copy + .copy { page-break-before: always; }
  .top { display: flex; align-items: flex-start; gap: 3mm;
         border-bottom: 1pt solid #111; padding-bottom: 1.5mm; }
  .shop { flex: 1; font-size: 13pt; font-weight: bold; line-height: 1.1; }
  .doc { text-align: right; font-size: 8.5pt; font-weight: bold; line-height: 1.35; }
  .to { padding: 2mm 0 1.5mm; }
  .party { font-size: 13pt; font-weight: bold; line-height: 1.2; }
  .dest { font-size: 11pt; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th, td { border: 0.7pt solid #555; padding: 1.2mm 1.5mm; text-align: left; }
  th { background: #eee; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.3pt; }
  td.num, th.num { text-align: right; }
  /* The bag count is what gets counted off the lorry, so it reads largest. */
  td.bags { text-align: center; font-weight: bold; font-size: 12pt; }
  th:nth-child(1), td:nth-child(1) { width: 12mm; }
  th:nth-child(3), td:nth-child(3) { width: 16mm; text-align: right; }
  th:nth-child(4), td:nth-child(4) { width: 20mm; text-align: right; }
  .pack { color: #555; font-size: 8pt; }
  tr.total td { font-weight: bold; background: #f2f2f2; font-size: 10.5pt; }
  .transport { padding-top: 1.5mm; font-size: 9pt; font-weight: bold; }
  .note { font-size: 8.5pt; padding-top: 0.8mm; }
  .sign { margin-top: 10mm; }
  .sign .line { border-top: 0.7pt solid #555; padding-top: 1mm;
                width: 45mm; font-size: 8pt; color: #333; }
  .tag { padding-top: 1.5mm; font-size: 7pt; color: #777;
         text-transform: uppercase; letter-spacing: 0.4pt; }
</style>
</head>
<body>
${copyBlock(doc, "Transporter copy", "goes with the gadi")}
${copyBlock(doc, "Office copy", "sign and return")}
</body>
</html>`;
}

/** The short version for WhatsApp - what gets sent to the transporter so the
 *  lorry knows what it is carrying before the paper arrives. */
export function buildChallanMessage(doc: ChallanDoc): string {
  const { challan, order, shop } = doc;
  const lines: string[] = [];
  lines.push(`${shop.name} - Delivery Challan ${challan.challanNo}`);
  lines.push(formatDate(challan.date));
  lines.push("");
  lines.push(`To: ${order.partyName}`);
  if (challan.destination) lines.push(`Destination: ${challan.destination}`);
  if (challan.vehicleNo) lines.push(`Vehicle: ${challan.vehicleNo}`);
  if (challan.driverName) {
    lines.push(
      `Driver: ${challan.driverName}${challan.driverPhone ? ` (${challan.driverPhone})` : ""}`,
    );
  }
  if (challan.lrNo) lines.push(`LR: ${challan.lrNo}`);
  lines.push("");
  for (const line of order.lines) {
    lines.push(`${line.itemName}: ${packingLabel(line)} = ${formatQty(line.qty)} kg`);
  }
  lines.push("");
  lines.push(
    `Total: ${formatQty(orderBags(order.lines))} nag, ${formatQty(orderKg(order.lines))} kg`,
  );
  if (challan.note) {
    lines.push("");
    lines.push(challan.note);
  }
  return lines.join("\n");
}

export function challanFileName(challanNo: string): string {
  // Slashes and spaces in a document number become a broken file path.
  return `challan-${challanNo.replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
}
