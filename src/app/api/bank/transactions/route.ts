import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { listTransactions, type BankView } from "@/lib/bank/bankService";
import { getEnv } from "@/lib/env";

const VIEWS: BankView[] = ["review", "assigned", "ignored", "out", "all"];

/** The bank ledger, filtered by what the screen is currently showing. */
export async function GET(req: NextRequest) {
  try {
    const { DEFAULT_COMPANY_ID } = getEnv();
    const params = req.nextUrl.searchParams;
    const requested = params.get("view") as BankView | null;
    const view = requested && VIEWS.includes(requested) ? requested : "review";

    const result = await listTransactions(DEFAULT_COMPANY_ID, {
      view,
      query: params.get("q") ?? "",
      customerId: params.get("customerId") ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    });

    return NextResponse.json({ view, ...result });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
