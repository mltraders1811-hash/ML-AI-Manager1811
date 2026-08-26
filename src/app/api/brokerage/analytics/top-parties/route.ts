import { NextRequest, NextResponse } from "next/server";

import { topParties } from "@/lib/brokerage/analyticsService";
import { getEnv } from "@/lib/env";

export async function GET(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const month = req.nextUrl.searchParams.get("month") ?? undefined;
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 25;
  const result = await topParties(DEFAULT_COMPANY_ID, month, Number.isFinite(limit) ? limit : 25);
  return NextResponse.json(result);
}
