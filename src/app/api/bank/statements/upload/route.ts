import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { importStatement } from "@/lib/bank/importService";
import { StatementParseError } from "@/lib/bank/types";
import { getEnv } from "@/lib/env";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED = [".csv", ".xlsx", ".xlsm", ".txt"];

/**
 * A statement picked from the phone. The same importer the daily Drive
 * pickup uses, so an uploaded file and an automatically-collected one
 * dedupe against each other rather than double-counting the month.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was chosen" }, { status: 400 });
    }
    if (!ACCEPTED.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      return NextResponse.json(
        { error: "Choose the statement as CSV or Excel (.csv, .xlsx). A PDF statement can't be read." },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "That file is bigger than 15MB" }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const { DEFAULT_COMPANY_ID } = getEnv();
    const outcome = await importStatement({
      companyId: DEFAULT_COMPANY_ID,
      filename: file.name,
      bytes,
      source: "UPLOAD",
    });

    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof StatementParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
