import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { deletePayment } from "@/lib/brokerage/paymentsService";
import { getEnv } from "@/lib/env";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { DEFAULT_COMPANY_ID } = getEnv();
  try {
    await deletePayment(DEFAULT_COMPANY_ID, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
