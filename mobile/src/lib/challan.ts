import { formatDate } from "./date";
import { formatINR, formatNumber, formatQty } from "./money";
import { orderBags, orderKg } from "./order";
import type { Challan, OrderLine, OrderWithLines, Party, ShopProfile } from "./types";

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

function field(label: string, value: string | null | undefined): string {
  const clean = (value ?? "").trim();
  if (!clean) return "";
  return `<div class="f"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(clean)}</span></div>`;
}

/** One copy of the challan. The sheet carries two of these: the transporter
 *  keeps one and signs the other, which comes back to the shop as proof the
 *  goods were handed over. */
function copyBlock(doc: ChallanDoc, label: string, signNote: string): string {
  const { challan, order, party, shop } = doc;
  const showRates = challan.showRates;

  const rows = order.lines
    .map((line) => {
      const cells = [
        `<td class="bags">${line.bags ? formatQty(line.bags) : "-"}</td>`,
        `<td>${escapeHtml(line.itemName)}</td>`,
        `<td class="num">${escapeHtml(packingLabel(line))}</td>`,
        `<td class="num">${formatQty(line.qty)}</td>`,
      ];
      if (showRates) {
        cells.push(`<td class="num">${escapeHtml(formatINR(line.amount))}</td>`);
      }
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  const cols = showRates ? 5 : 4;
  const head = showRates
    ? "<th>Bags</th><th>Item</th><th>Packing</th><th>Kg</th><th>Amount</th>"
    : "<th>Bags</th><th>Item</th><th>Packing</th><th>Kg</th>";

  return `
  <section class="copy">
    <div class="tag">${escapeHtml(label)}</div>

    <div class="head">
      <div class="shop">
        <div class="name">${escapeHtml(shop.name)}</div>
        ${shop.address ? `<div class="sub">${escapeHtml(shop.address)}</div>` : ""}
        ${shop.phone ? `<div class="sub">Ph: ${escapeHtml(shop.phone)}</div>` : ""}
        ${shop.gstin ? `<div class="sub">GSTIN: ${escapeHtml(shop.gstin)}</div>` : ""}
      </div>
      <div class="docno">
        <div class="f"><span class="k">Challan</span><span class="v">${escapeHtml(challan.challanNo)}</span></div>
        <div class="f"><span class="k">Date</span><span class="v">${escapeHtml(formatDate(challan.date))}</span></div>
        <div class="f"><span class="k">Order</span><span class="v">${escapeHtml(order.orderNo)}</span></div>
      </div>
    </div>

    <div class="to">
      <div class="party">${escapeHtml(order.partyName)}</div>
      ${challan.destination ? `<div class="dest">${escapeHtml(challan.destination)}</div>` : ""}
      ${party?.phone ? `<div class="sub">Ph: ${escapeHtml(party.phone)}</div>` : ""}
    </div>

    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>
        ${rows || `<tr><td colspan="${cols}">No items</td></tr>`}
        <tr class="total">
          <td class="bags">${formatQty(orderBags(order.lines))}</td>
          <td>नग / bags</td>
          <td class="num"></td>
          <td class="num">${formatQty(orderKg(order.lines))}</td>
          ${showRates ? `<td class="num">${escapeHtml(formatINR(order.total))}</td>` : ""}
        </tr>
      </tbody>
    </table>

    <div class="transport">
      ${field("Transporter", challan.transporterName)}
      ${field("Vehicle no.", challan.vehicleNo)}
      ${field("LR / builty", challan.lrNo)}
      ${field("Driver", challan.driverName)}
      ${field("Driver ph.", challan.driverPhone)}
    </div>

    ${challan.note ? `<div class="note">${escapeHtml(challan.note)}</div>` : ""}

    <div class="sign">
      <div class="line">Transporter's signature<div class="tiny">${escapeHtml(signNote)}</div></div>
      <div class="line">For ${escapeHtml(shop.name)}</div>
    </div>
  </section>`;
}

/** The printable challan: two identical copies on one A4 sheet with a cut
 *  line between them, which is the way it is done by hand today - the lorry
 *  takes one, signs the other, and the signed one comes back to the shop. */
export function buildChallanHtml(doc: ChallanDoc): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Challan ${escapeHtml(doc.challan.challanNo)}</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  /* Item names get written in Hindi, so the stack has to reach a Devanagari
     face before it falls back to a Latin-only one and prints boxes. */
  body { margin: 0; color: #111;
         font-family: "Noto Sans Devanagari", "Noto Sans", Roboto, "Segoe UI", Arial, sans-serif; }
  .copy { border: 1.2pt solid #111; padding: 4mm; position: relative; }
  .cut { border-top: 1pt dashed #888; margin: 3mm 0; text-align: center;
         font-size: 7.5pt; color: #888; letter-spacing: 1pt; }
  .tag { position: absolute; top: 0; right: 0; background: #111; color: #fff;
         font-size: 7.5pt; letter-spacing: 0.6pt; padding: 1mm 2.5mm; text-transform: uppercase; }
  .head { display: flex; gap: 4mm; align-items: flex-start;
          border-bottom: 1pt solid #111; padding-bottom: 2mm; }
  .shop { flex: 1; }
  .shop .name { font-size: 15pt; font-weight: bold; line-height: 1.15; }
  .sub { font-size: 8.5pt; color: #333; }
  .docno { min-width: 42mm; }
  .f { display: flex; gap: 1.5mm; font-size: 9pt; line-height: 1.45; }
  .k { color: #555; min-width: 19mm; }
  .v { font-weight: bold; flex: 1; }
  .to { padding: 2mm 0; }
  .party { font-size: 14pt; font-weight: bold; line-height: 1.2; }
  .dest { font-size: 11pt; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border: 0.8pt solid #555; padding: 1.6mm 2mm; text-align: left; }
  th { background: #eee; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.3pt; }
  td.num, th.num { text-align: right; }
  /* The bag count is what gets counted off the lorry, so it reads largest. */
  td.bags { text-align: center; font-weight: bold; font-size: 12pt; }
  /* Fixed widths for the figures, so the item name - which can be a long
     Hindi word - gets whatever is left instead of a dead gap. */
  th:nth-child(1), td:nth-child(1) { width: 14mm; }
  th:nth-child(3), td:nth-child(3) { width: 32mm; }
  th:nth-child(4), td:nth-child(4) { width: 20mm; }
  th:nth-child(5), td:nth-child(5) { width: 26mm; }
  tr.total td { font-weight: bold; background: #f2f2f2; font-size: 11pt; }
  .transport { display: flex; flex-wrap: wrap; column-gap: 6mm; padding-top: 2mm; }
  .transport .f { min-width: 45mm; }
  .note { font-size: 9.5pt; padding-top: 1.5mm; }
  .sign { display: flex; gap: 6mm; margin-top: 9mm; }
  .sign .line { flex: 1; border-top: 0.8pt solid #555; padding-top: 1.2mm;
                font-size: 8.5pt; color: #333; }
  .tiny { font-size: 7.5pt; color: #777; }
</style>
</head>
<body>
${copyBlock(doc, "Transporter copy", "goes with the gadi")}
<div class="cut">— — — — — — — — — —  cut here  — — — — — — — — — —</div>
${copyBlock(doc, "Office copy", "sign and return to the shop")}
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
