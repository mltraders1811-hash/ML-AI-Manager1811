import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { deleteReport, getReportWithBrokers } from "@/lib/brokerage/reportService";
import { getEnv } from "@/lib/env";

function serializeBroker(b: {
  name: string;
  isShopOwn: boolean;
  totalQty: { toNumber(): number };
  totalAmount: { toNumber(): number };
  totalBrokerage: { toNumber(): number };
  transactionCount: number;
}) {
  return {
    name: b.name,
    isShopOwn: b.isShopOwn,
    totalQty: b.totalQty.toNumber(),
    totalAmount: b.totalAmount.toNumber(),
    totalBrokerage: b.totalBrokerage.toNumber(),
    transactionCount: b.transactionCount,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { DEFAULT_COMPANY_ID } = getEnv();
  try {
    const report = await getReportWithBrokers(DEFAULT_COMPANY_ID, id);
    return NextResponse.json({
      id: report.id,
      filename: report.filename,
      fileSize: report.fileSize,
      uploadedAt: report.uploadedAt,
      month: report.month,
      summary: {
        totalTransactions: report.totalTransactions,
        totalAmount: report.totalAmount.toNumber(),
        totalBrokerage: report.totalBrokerage.toNumber(),
        brokerCount: report.brokerCount,
        shopOwnCount: report.shopOwnCount,
      },
      brokers: report.brokers.map(serializeBroker),
    });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { DEFAULT_COMPANY_ID } = getEnv();
  try {
    await deleteReport(DEFAULT_COMPANY_ID, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
