import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { toErrorResponse } from "@/lib/apiError";
import { addPayment } from "@/lib/brokerage/paymentsService";
import { getEnv } from "@/lib/env";

const bodySchema = z.object({
  reportId: z.string().min(1),
  broker: z.string().min(1),
  amount: z.number(),
  note: z.string().optional(),
  paidOn: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const payment = await addPayment(DEFAULT_COMPANY_ID, parsed.data);
    return NextResponse.json({ ...payment, amount: payment.amount.toNumber() });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
