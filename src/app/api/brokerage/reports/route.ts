import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { listReports } from "@/lib/brokerage/reportService";

export async function GET() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const reports = await listReports(DEFAULT_COMPANY_ID);
  return NextResponse.json({
    reports: reports.map((r) => ({
      id: r.id,
      filename: r.filename,
      fileSize: r.fileSize,
      uploadedAt: r.uploadedAt,
      month: r.month,
      summary: {
        totalTransactions: r.totalTransactions,
        totalAmount: r.totalAmount.toNumber(),
        totalBrokerage: r.totalBrokerage.toNumber(),
        brokerCount: r.brokerCount,
        shopOwnCount: r.shopOwnCount,
      },
    })),
  });
}
