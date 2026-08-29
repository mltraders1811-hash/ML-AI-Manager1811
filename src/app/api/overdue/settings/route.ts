import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_CREDIT_DAYS,
  DEFAULT_REMINDER_TEMPLATE,
  REMINDER_PLACEHOLDERS,
  getOverdueSettings,
} from "@/lib/overdue";

export async function GET() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const settings = await getOverdueSettings(DEFAULT_COMPANY_ID);
  return NextResponse.json({
    ...settings,
    defaultReminderTemplate: DEFAULT_REMINDER_TEMPLATE,
    defaultCreditDays: DEFAULT_CREDIT_DAYS,
    placeholders: REMINDER_PLACEHOLDERS,
  });
}

const bodySchema = z.object({
  creditDays: z.number().int().min(0).max(365).optional(),
  reminderTemplate: z.string().optional(),
});

export async function PUT(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "creditDays must be 0-365; reminderTemplate must be text" }, { status: 400 });
  }
  if (parsed.data.creditDays === undefined && parsed.data.reminderTemplate === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const current = await getOverdueSettings(DEFAULT_COMPANY_ID);
  // An empty template would render blank reminders, so treat "cleared" as
  // "reset to the built-in wording" rather than saving nothing.
  const template =
    parsed.data.reminderTemplate === undefined
      ? current.reminderTemplate
      : parsed.data.reminderTemplate.trim() || DEFAULT_REMINDER_TEMPLATE;
  const creditDays = parsed.data.creditDays ?? current.creditDays;

  await prisma.overdueSettings.upsert({
    where: { companyId: DEFAULT_COMPANY_ID },
    update: { creditDays, reminderTemplate: template },
    create: { companyId: DEFAULT_COMPANY_ID, creditDays, reminderTemplate: template },
  });

  return NextResponse.json({ ok: true, creditDays, reminderTemplate: template });
}
