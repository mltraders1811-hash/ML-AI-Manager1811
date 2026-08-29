import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getOverdueCustomers } from "@/lib/overdue";

/** History for one customer, newest first - shown when a row is expanded. */
export async function GET(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const customerId = req.nextUrl.searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });

  const reminders = await prisma.reminderLog.findMany({
    where: { companyId: DEFAULT_COMPANY_ID, customerId },
    orderBy: { sentAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    reminders: reminders.map((r) => ({
      id: r.id,
      sentAt: r.sentAt.toISOString(),
      balanceAtSend: r.balanceAtSend.toNumber(),
      overdueAtSend: r.overdueAtSend.toNumber(),
      daysOverdueAtSend: r.daysOverdueAtSend,
    })),
  });
}

const bodySchema = z.object({ customerId: z.string().min(1) });

/**
 * Records that a reminder was sent. Called when the WhatsApp button is
 * clicked - the app can't know whether the message was actually delivered
 * (it hands off to WhatsApp), so this records the intent to chase, which is
 * what "have I already contacted them?" really asks.
 *
 * The amounts are captured from the current overdue calculation rather than
 * trusted from the client, so the record can't be skewed by a stale page.
 */
export async function POST(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "customerId is required" }, { status: 400 });

  const customer = await prisma.customer.findFirst({
    where: { id: parsed.data.customerId, companyId: DEFAULT_COMPANY_ID },
    select: { id: true },
  });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const { customers } = await getOverdueCustomers(DEFAULT_COMPANY_ID);
  const detail = customers.find((c) => c.customerId === customer.id);

  const log = await prisma.reminderLog.create({
    data: {
      companyId: DEFAULT_COMPANY_ID,
      customerId: customer.id,
      balanceAtSend: detail?.balance ?? 0,
      overdueAtSend: detail?.overdueAmount ?? 0,
      daysOverdueAtSend: detail?.maxDaysOverdue ?? 0,
    },
  });

  return NextResponse.json({ ok: true, sentAt: log.sentAt.toISOString() });
}
