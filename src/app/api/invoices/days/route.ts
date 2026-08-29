import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { listInvoicesForDay, listSaleDays } from "@/lib/invoices";

export async function GET(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const date = req.nextUrl.searchParams.get("date");

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    return NextResponse.json({ dateIso: date, invoices: await listInvoicesForDay(DEFAULT_COMPANY_ID, date) });
  }

  return NextResponse.json({ days: await listSaleDays(DEFAULT_COMPANY_ID) });
}
