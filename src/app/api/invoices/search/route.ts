import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { searchInvoices } from "@/lib/invoices";

export async function GET(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ query: q, invoices: await searchInvoices(DEFAULT_COMPANY_ID, q) });
}
