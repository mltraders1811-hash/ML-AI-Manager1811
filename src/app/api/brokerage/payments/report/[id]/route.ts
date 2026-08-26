import { NextRequest, NextResponse } from "next/server";

import { listPayments } from "@/lib/brokerage/paymentsService";
import { getEnv } from "@/lib/env";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { DEFAULT_COMPANY_ID } = getEnv();
  const payments = await listPayments(DEFAULT_COMPANY_ID, id);
  return NextResponse.json({
    payments: payments.map((p) => ({
      id: p.id,
      reportId: p.reportId,
      broker: p.broker,
      amount: p.amount.toNumber(),
      note: p.note,
      paidOn: p.paidOn,
      createdAt: p.createdAt,
    })),
  });
}
