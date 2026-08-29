import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

// Only the locally-owned fields are editable. Name and balance come from
// Vyapar on every sync and would be overwritten, so they're not exposed here.
const bodySchema = z.object({
  phone: z.string().max(30).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  creditDays: z.number().int().min(0).max(365).nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const { id } = await ctx.params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "phone/note must be text (or null); creditDays must be 0-365 (or null to use the default)" },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const data: { phone?: string | null; note?: string | null; creditDays?: number | null } = {};
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone?.trim() || null;
  if (parsed.data.note !== undefined) data.note = parsed.data.note?.trim() || null;
  if (parsed.data.creditDays !== undefined) data.creditDays = parsed.data.creditDays;

  const res = await prisma.customer.updateMany({
    where: { id, companyId: DEFAULT_COMPANY_ID },
    data,
  });
  if (res.count === 0) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, name: true, phone: true, note: true, creditDays: true, currentBalance: true },
  });
  return NextResponse.json({
    ok: true,
    customer: customer && {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      note: customer.note,
      creditDays: customer.creditDays,
      balance: customer.currentBalance.toNumber(),
    },
  });
}
