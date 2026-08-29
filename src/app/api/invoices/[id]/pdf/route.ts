import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { getInvoiceDetail } from "@/lib/invoices";
import { buildInvoicePdf, getInvoiceDesign } from "@/lib/invoicePdf";

// pdfkit needs Node APIs (fonts, streams), not the Edge runtime.
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const { id } = await ctx.params;

  const invoice = await getInvoiceDetail(DEFAULT_COMPANY_ID, id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const design = await getInvoiceDesign(DEFAULT_COMPANY_ID);
  const pdf = await buildInvoicePdf(invoice, design);

  const safeParty = invoice.party.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
  const filename = `invoice_${safeParty}_${invoice.dateIso}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // inline so it opens in a browser tab rather than forcing a download.
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
