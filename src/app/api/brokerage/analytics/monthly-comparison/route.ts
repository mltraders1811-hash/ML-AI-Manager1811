import { NextResponse } from "next/server";

import { monthlyComparison } from "@/lib/brokerage/analyticsService";
import { getEnv } from "@/lib/env";

export async function GET() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const result = await monthlyComparison(DEFAULT_COMPANY_ID);
  return NextResponse.json(result);
}
