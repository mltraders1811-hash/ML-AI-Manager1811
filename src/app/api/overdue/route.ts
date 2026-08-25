import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { getOverdueCustomers } from "@/lib/metrics";
import { buildWhatsAppReminderLink } from "@/lib/whatsapp";

export async function GET() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const customers = await getOverdueCustomers(DEFAULT_COMPANY_ID);

  return NextResponse.json({
    customers: customers.map((c) => ({
      ...c,
      whatsappLink: buildWhatsAppReminderLink({ phone: c.phone, amount: c.totalOverdue, dueSince: c.oldestDueDate }),
    })),
  });
}
