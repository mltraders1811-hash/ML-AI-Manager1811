import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { getOverdueCustomers } from "@/lib/overdue";
import { buildWhatsAppLink } from "@/lib/whatsapp";

export async function GET(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();

  const raw = req.nextUrl.searchParams.get("creditDays");
  let creditDaysOverride: number | undefined;
  if (raw !== null && raw !== "") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      return NextResponse.json({ error: "creditDays must be a whole number between 0 and 365" }, { status: 400 });
    }
    creditDaysOverride = n;
  }

  const result = await getOverdueCustomers(DEFAULT_COMPANY_ID, creditDaysOverride);

  return NextResponse.json({
    ...result,
    customers: result.customers.map((c) => ({
      ...c,
      whatsappLink: buildWhatsAppLink(c.phone, c.reminderMessage),
    })),
  });
}
