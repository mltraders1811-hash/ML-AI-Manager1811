import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { toErrorResponse } from "@/lib/apiError";
import { assignTransaction, ignoreTransaction, setNote, unassignTransaction } from "@/lib/bank/bankService";
import { getEnv } from "@/lib/env";

// One route for the four things that can be decided about a bank line, so
// the phone makes one kind of request whichever button is tapped.
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    customerId: z.string().min(1),
    /** Clear the payer's other undecided lines with the same decision. */
    applySimilar: z.boolean().optional(),
    note: z.string().max(500).nullable().optional(),
  }),
  z.object({ action: z.literal("ignore"), reason: z.string().max(200).nullable().optional() }),
  z.object({ action: z.literal("unassign") }),
  z.object({ action: z.literal("note"), note: z.string().max(500).nullable() }),
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { DEFAULT_COMPANY_ID } = getEnv();

  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const body = parsed.data;

    switch (body.action) {
      case "assign": {
        const { transaction, alsoApplied } = await assignTransaction(DEFAULT_COMPANY_ID, id, body.customerId, {
          applySimilar: body.applySimilar,
          note: body.note,
        });
        return NextResponse.json({ transaction, alsoApplied });
      }
      case "ignore":
        return NextResponse.json({ transaction: await ignoreTransaction(DEFAULT_COMPANY_ID, id, body.reason ?? null) });
      case "unassign":
        return NextResponse.json({ transaction: await unassignTransaction(DEFAULT_COMPANY_ID, id) });
      case "note":
        return NextResponse.json({ transaction: await setNote(DEFAULT_COMPANY_ID, id, body.note) });
    }
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
