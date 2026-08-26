import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { parseSaleReport } from "@/lib/brokerage/excelParser";
import { saveParsedReport } from "@/lib/brokerage/reportService";
import { ReportParseError } from "@/lib/brokerage/types";
import { getEnv } from "@/lib/env";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json(
        { error: "Only .xlsx files are supported (re-save .xls files as .xlsx first)" },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
    }

    const parsed = await parseSaleReport(buffer);
    const { DEFAULT_COMPANY_ID } = getEnv();
    const report = await saveParsedReport(DEFAULT_COMPANY_ID, file.name, buffer.length, parsed);

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
    });
  } catch (err) {
    if (err instanceof ReportParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
