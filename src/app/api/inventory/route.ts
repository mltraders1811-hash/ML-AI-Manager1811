import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { getSoldItems, listItems } from "@/lib/inventory";

export async function GET(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const params = req.nextUrl.searchParams;

  if (params.get("view") === "items") {
    return NextResponse.json(await listItems(DEFAULT_COMPANY_ID, params.get("q") ?? undefined));
  }

  const raw = Number(params.get("days") ?? 30);
  const days = Number.isInteger(raw) && raw > 0 && raw <= 365 ? raw : 30;
  return NextResponse.json(await getSoldItems(DEFAULT_COMPANY_ID, days));
}
