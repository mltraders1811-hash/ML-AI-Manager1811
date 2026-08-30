import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { getBankSummary, getReceiptsByCustomer } from "@/lib/bank/bankService";
import { istStartOfDay } from "@/lib/dateIst";
import { getEnv } from "@/lib/env";

/** Headline figures for the bank screen, plus who has actually paid this month. */
export async function GET() {
  try {
    const { DEFAULT_COMPANY_ID } = getEnv();
    const today = istStartOfDay(new Date());
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

    const [summary, receipts] = await Promise.all([
      getBankSummary(DEFAULT_COMPANY_ID),
      getReceiptsByCustomer(DEFAULT_COMPANY_ID, { from: monthStart }),
    ]);

    return NextResponse.json({ ...summary, receiptsThisMonth: receipts.slice(0, 20) });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
