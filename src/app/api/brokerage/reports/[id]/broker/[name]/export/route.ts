import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { getBrokerDetail } from "@/lib/brokerage/reportService";
import { buildBrokerExcelBuffer, buildBrokerPdfBuffer, buildTextReport } from "@/lib/brokerage/exporters";
import { getEnv } from "@/lib/env";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  const fmt = (req.nextUrl.searchParams.get("fmt") || "text").toLowerCase();
  const { DEFAULT_COMPANY_ID } = getEnv();

  try {
    const { report, broker } = await getBrokerDetail(DEFAULT_COMPANY_ID, id, decodeURIComponent(name));
    const exportBroker = {
      name: broker.name,
      transactionCount: broker.transactionCount,
      totalAmount: broker.totalAmount.toNumber(),
      totalBrokerage: broker.totalBrokerage.toNumber(),
      transactions: broker.transactions.map((t) => ({
        date: t.date,
        party: t.party,
        item: t.item,
        quantity: t.quantity.toNumber(),
        price: t.price.toNumber(),
        amount: t.amount.toNumber(),
        brokerage: t.brokerage.toNumber(),
      })),
    };
    const baseName = `${broker.name}_brokerage`;

    if (fmt === "text") {
      const content = buildTextReport(exportBroker, report.filename);
      return NextResponse.json({ format: "text", content, filename: `${baseName}.txt` });
    }
    if (fmt === "excel") {
      const data = await buildBrokerExcelBuffer(exportBroker);
      return NextResponse.json({
        format: "excel",
        filename: `${baseName}.xlsx`,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64: data.toString("base64"),
      });
    }
    if (fmt === "pdf") {
      const data = await buildBrokerPdfBuffer(exportBroker);
      return NextResponse.json({
        format: "pdf",
        filename: `${baseName}.pdf`,
        mime: "application/pdf",
        base64: data.toString("base64"),
      });
    }
    return NextResponse.json({ error: "Invalid format. Use text|excel|pdf" }, { status: 400 });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
