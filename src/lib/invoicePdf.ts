import PDFDocument from "pdfkit";

import { prisma } from "@/lib/prisma";
import { formatInr } from "@/lib/format";

import type { InvoiceDetail } from "./invoices";

export type InvoiceDesign = {
  businessName: string;
  addressLine: string | null;
  phone: string | null;
  gstin: string | null;
  accentColor: string;
  footerNote: string | null;
  showLineItems: boolean;
};

export const DEFAULT_INVOICE_DESIGN: InvoiceDesign = {
  businessName: "M.L. Traders",
  addressLine: null,
  phone: null,
  gstin: null,
  accentColor: "#2B5336",
  footerNote: "Thank you for your business.",
  showLineItems: true,
};

/** pdfkit throws on a malformed colour, which would turn a bad settings
 * value into a 500 on every invoice. Fall back instead. */
export function safeHexColor(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : fallback;
}

export async function getInvoiceDesign(companyId: string): Promise<InvoiceDesign> {
  const row = await prisma.invoiceDesignSettings.findUnique({ where: { companyId } });
  if (!row) return DEFAULT_INVOICE_DESIGN;
  return {
    businessName: row.businessName || DEFAULT_INVOICE_DESIGN.businessName,
    addressLine: row.addressLine,
    phone: row.phone,
    gstin: row.gstin,
    accentColor: safeHexColor(row.accentColor, DEFAULT_INVOICE_DESIGN.accentColor),
    footerNote: row.footerNote,
    showLineItems: row.showLineItems,
  };
}

const MARGIN = 40;
const ROW_HEIGHT = 18;
const COLS = [
  { label: "Item", width: 220 },
  { label: "Qty", width: 60 },
  { label: "Rate", width: 90 },
  { label: "Amount", width: 105 },
];

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function buildInvoicePdf(invoice: InvoiceDetail, design: InvoiceDesign): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const accent = safeHexColor(design.accentColor, DEFAULT_INVOICE_DESIGN.accentColor);
    const left = doc.page.margins.left;
    const contentWidth = doc.page.width - MARGIN * 2;

    // --- Header band ---
    doc.rect(0, 0, doc.page.width, 90).fill(accent);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(20).text(design.businessName, MARGIN, 26, {
      width: contentWidth * 0.6,
    });
    const subtitle = [design.addressLine, design.phone ? `Ph: ${design.phone}` : null, design.gstin ? `GSTIN: ${design.gstin}` : null]
      .filter(Boolean)
      .join("  |  ");
    if (subtitle) {
      doc.font("Helvetica").fontSize(9).text(subtitle, MARGIN, 54, { width: contentWidth * 0.6 });
    }
    doc.font("Helvetica-Bold").fontSize(14).text("INVOICE", MARGIN, 30, { width: contentWidth, align: "right" });
    doc
      .font("Helvetica")
      .fontSize(9)
      .text(prettyDate(invoice.dateIso) + (invoice.invoiceNumber ? `  ·  #${invoice.invoiceNumber}` : ""), MARGIN, 50, {
        width: contentWidth,
        align: "right",
      });

    // --- Bill to ---
    doc.fillColor("#666666").font("Helvetica").fontSize(9).text("BILL TO", MARGIN, 112);
    doc.fillColor("#111111").font("Helvetica-Bold").fontSize(13).text(invoice.party, MARGIN, 126);
    if (invoice.partyPhone) {
      doc.fillColor("#666666").font("Helvetica").fontSize(9).text(invoice.partyPhone, MARGIN, 144);
    }

    let y = 172;

    if (design.showLineItems && invoice.lineItems.length > 0) {
      const tableWidth = COLS.reduce((s, c) => s + c.width, 0);

      const drawHeader = (top: number): number => {
        doc.rect(left, top, tableWidth, ROW_HEIGHT).fill(accent);
        let x = left;
        doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9);
        for (const col of COLS) {
          doc.text(col.label, x + 5, top + 5, {
            width: col.width - 10,
            align: col.label === "Item" ? "left" : "right",
          });
          x += col.width;
        }
        return top + ROW_HEIGHT;
      };

      const drawRow = (top: number, values: string[]): number => {
        let x = left;
        doc.fillColor("#111111").font("Helvetica").fontSize(9);
        for (let i = 0; i < COLS.length; i++) {
          const col = COLS[i]!;
          doc.text(values[i] ?? "", x + 5, top + 5, {
            width: col.width - 10,
            align: i === 0 ? "left" : "right",
            lineBreak: false,
          });
          x += col.width;
        }
        doc.strokeColor("#E2E2DE").lineWidth(0.5).rect(left, top, tableWidth, ROW_HEIGHT).stroke();
        return top + ROW_HEIGHT;
      };

      const bottomLimit = doc.page.height - doc.page.margins.bottom - 60;
      y = drawHeader(y);
      for (const li of invoice.lineItems) {
        if (y + ROW_HEIGHT > bottomLimit) {
          doc.addPage();
          y = drawHeader(MARGIN);
        }
        y = drawRow(y, [li.itemName, String(li.quantity), formatInr(li.unitPrice), formatInr(li.amount)]);
      }

      // --- Total ---
      doc.rect(left, y, tableWidth, ROW_HEIGHT + 4).fill("#F3F4F1");
      doc.fillColor("#111111").font("Helvetica-Bold").fontSize(11);
      doc.text("Total", left + 5, y + 6, { width: COLS[0]!.width + COLS[1]!.width + COLS[2]!.width - 10, align: "right" });
      doc.text(`Rs. ${formatInr(invoice.totalAmount)}`, left + tableWidth - COLS[3]!.width + 5, y + 6, {
        width: COLS[3]!.width - 10,
        align: "right",
      });
      y += ROW_HEIGHT + 16;
    } else {
      // No line items recorded (or the owner turned them off) - still show
      // the amount so the document is a usable bill.
      doc.fillColor("#666666").font("Helvetica").fontSize(9).text("AMOUNT", MARGIN, y);
      doc.fillColor("#111111").font("Helvetica-Bold").fontSize(20).text(`Rs. ${formatInr(invoice.totalAmount)}`, MARGIN, y + 14);
      y += 56;
    }

    if (design.footerNote) {
      doc.fillColor("#666666").font("Helvetica").fontSize(9).text(design.footerNote, MARGIN, y, { width: contentWidth });
    }

    doc.end();
  });
}
