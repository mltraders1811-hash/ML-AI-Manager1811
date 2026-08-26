import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { inactiveParties } from "@/lib/brokerage/analyticsService";
import { getEnv } from "@/lib/env";

export async function GET(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const month = req.nextUrl.searchParams.get("month") ?? undefined;
  const thresholdParam = req.nextUrl.searchParams.get("drop_threshold");
  const dropThreshold = thresholdParam ? parseFloat(thresholdParam) : 25.0;
  try {
    const result = await inactiveParties(DEFAULT_COMPANY_ID, month, Number.isFinite(dropThreshold) ? dropThreshold : 25.0);
    return NextResponse.json(result);
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
