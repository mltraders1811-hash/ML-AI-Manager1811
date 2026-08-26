// Renders a broker's statement as WhatsApp text, an Excel workbook, or a
// PDF. Ported from khaata's backend/app/services/exporters.py
// (openpyxl/reportlab) to TypeScript (exceljs/pdfkit).
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

import { formatInr } from "@/lib/format";

export type ExportBrokerTransaction = {
  date: string;
  party: string;
  item: string;
  quantity: number;
  price: number;
  amount: number;
  brokerage: number;
};

export type ExportBroker = {
  name: string;
  transactionCount: number;
  totalAmount: number;
  totalBrokerage: number;
  transactions: ExportBrokerTransaction[];
};

export function buildTextReport(broker: ExportBroker, reportFilename: string): string {
  const lines: string[] = [];
  lines.push(`*${broker.name} - Brokerage Report*`);
  lines.push(`_Source: ${reportFilename}_`);
  lines.push("");
  for (const t of broker.transactions) {
    lines.push(`${t.date}  |  ${t.party}`);
    lines.push(`  ${t.item}   Qty: ${t.quantity}   @ ₹${formatInr(t.price)}`);
    lines.push(`  Amount: ₹${formatInr(t.amount)}   Brokerage: ₹${formatInr(t.brokerage)}`);
    lines.push("");
  }
  lines.push("———————————————");
  lines.push(`*Total Transactions:* ${broker.transactionCount}`);
  lines.push(`*Total Amount:* ₹${formatInr(broker.totalAmount)}`);
  lines.push(`*Total Brokerage (0.5%):* ₹${formatInr(broker.totalBrokerage)}`);
  return lines.join("\n");
}

const THIN_BORDER: Partial<ExcelJS.Borders> = (() => {
  const side: ExcelJS.Border = { style: "thin", color: { argb: "FFD1D1CC" } };
  return { top: side, left: side, bottom: side, right: side };
})();

export async function buildBrokerExcelBuffer(broker: ExportBroker): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(broker.name.slice(0, 31) || "Broker");

  ws.mergeCells("A1:G1");
  const title = ws.getCell("A1");
  title.value = `${broker.name} - Brokerage Report`;
  title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A22" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  const headers = ["Date", "Party Name", "Item Name", "Quantity", "Price/Unit", "Amount", "Brokerage"];
  const headerRow = ws.getRow(3);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2B5336" } };
    cell.alignment = { horizontal: "center" };
    cell.border = THIN_BORDER;
  });

  let rowIndex = 4;
  for (const t of broker.transactions) {
    const row = ws.getRow(rowIndex);
    row.getCell(1).value = t.date;
    row.getCell(2).value = t.party;
    row.getCell(3).value = t.item;
    row.getCell(4).value = t.quantity;
    row.getCell(5).value = t.price;
    row.getCell(6).value = t.amount;
    row.getCell(7).value = t.brokerage;
    for (let c = 1; c <= 7; c++) row.getCell(c).border = THIN_BORDER;
    rowIndex++;
  }

  const totalRow = ws.getRow(rowIndex + 1);
  totalRow.getCell(5).value = "Total";
  totalRow.getCell(5).font = { bold: true };
  totalRow.getCell(6).value = broker.totalAmount;
  totalRow.getCell(6).font = { bold: true };
  totalRow.getCell(7).value = broker.totalBrokerage;
  totalRow.getCell(7).font = { bold: true };

  const widths = [12, 28, 22, 10, 12, 14, 14];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

const PDF_COLS = [
  { label: "Date", width: 60 },
  { label: "Party Name", width: 115 },
  { label: "Item", width: 95 },
  { label: "Qty", width: 40 },
  { label: "Price", width: 55 },
  { label: "Amount", width: 65 },
  { label: "Brokerage", width: 65 },
];
const PDF_MARGIN = 40;
const PDF_ROW_HEIGHT = 18;

export function buildBrokerPdfBuffer(broker: ExportBroker): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PDF_MARGIN });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fillColor("#1B2A22").fontSize(18).font("Helvetica-Bold").text(`${broker.name} — Brokerage Report`);
    doc
      .fillColor("#666666")
      .fontSize(10)
      .font("Helvetica")
      .text(
        `Total Transactions: ${broker.transactionCount}  |  Total Amount: Rs. ${formatInr(broker.totalAmount)}  |  Brokerage: Rs. ${formatInr(broker.totalBrokerage)}`,
      );
    doc.moveDown(0.6);

    const tableLeft = doc.page.margins.left;
    const tableWidth = PDF_COLS.reduce((s, c) => s + c.width, 0);

    function drawHeader(y: number): number {
      doc.rect(tableLeft, y, tableWidth, PDF_ROW_HEIGHT).fill("#2B5336");
      let x = tableLeft;
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      for (const col of PDF_COLS) {
        doc.text(col.label, x + 4, y + 5, { width: col.width - 8, align: "left" });
        x += col.width;
      }
      return y + PDF_ROW_HEIGHT;
    }

    function drawRow(y: number, values: string[], opts?: { bold?: boolean; bg?: string }): number {
      if (opts?.bg) doc.rect(tableLeft, y, tableWidth, PDF_ROW_HEIGHT).fill(opts.bg);
      let x = tableLeft;
      doc.fillColor("#111111").font(opts?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      for (let i = 0; i < PDF_COLS.length; i++) {
        const col = PDF_COLS[i]!;
        doc.text(values[i] ?? "", x + 4, y + 5, { width: col.width - 8, align: "left" });
        x += col.width;
      }
      doc.strokeColor("#D1D1CC").lineWidth(0.5).rect(tableLeft, y, tableWidth, PDF_ROW_HEIGHT).stroke();
      return y + PDF_ROW_HEIGHT;
    }

    const bottomLimit = doc.page.height - doc.page.margins.bottom;
    let y = drawHeader(doc.y);

    for (const t of broker.transactions) {
      if (y + PDF_ROW_HEIGHT > bottomLimit) {
        doc.addPage();
        y = drawHeader(PDF_MARGIN);
      }
      y = drawRow(y, [
        t.date,
        t.party.slice(0, 24),
        t.item.slice(0, 18),
        String(t.quantity),
        formatInr(t.price),
        formatInr(t.amount),
        formatInr(t.brokerage),
      ]);
    }

    if (y + PDF_ROW_HEIGHT > bottomLimit) {
      doc.addPage();
      y = drawHeader(PDF_MARGIN);
    }
    drawRow(y, ["", "", "", "", "Total", formatInr(broker.totalAmount), formatInr(broker.totalBrokerage)], {
      bold: true,
      bg: "#E2EFE5",
    });

    doc.end();
  });
}
