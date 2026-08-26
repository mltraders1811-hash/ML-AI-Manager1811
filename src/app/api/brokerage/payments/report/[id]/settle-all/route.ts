import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { toErrorResponse } from "@/lib/apiError";
import { settleAll } from "@/lib/brokerage/paymentsService";
import { getEnv } from "@/lib/env";

const bodySchema = z.object({ note: z.string().optional(), paidOn: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { DEFAULT_COMPANY_ID } = getEnv();
  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  const { note, paidOn } = parsed.success ? parsed.data : {};

  try {
    const created = await settleAll(DEFAULT_COMPANY_ID, id, note, paidOn);
    return NextResponse.json({
      count: created.length,
      payments: created.map((p) => ({
        id: p.id,
        reportId: p.reportId,
        broker: p.broker,
        amount: p.amount.toNumber(),
        note: p.note,
        paidOn: p.paidOn,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
