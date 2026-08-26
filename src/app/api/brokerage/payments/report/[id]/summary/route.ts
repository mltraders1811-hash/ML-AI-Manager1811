import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { paymentSummary } from "@/lib/brokerage/paymentsService";
import { getEnv } from "@/lib/env";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { DEFAULT_COMPANY_ID } = getEnv();
  try {
    const summary = await paymentSummary(DEFAULT_COMPANY_ID, id);
    return NextResponse.json(summary);
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
