import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { getInvoiceDetail } from "@/lib/invoices";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const { id } = await ctx.params;
  const invoice = await getInvoiceDetail(DEFAULT_COMPANY_ID, id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json({ invoice });
}
