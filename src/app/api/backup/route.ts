import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { buildBackup } from "@/lib/backup";

export const runtime = "nodejs";

/** Downloads everything in this database that a Vyapar re-sync could not
 * rebuild. Behind the admin login like every other route. */
export async function GET() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const backup = await buildBackup(DEFAULT_COMPANY_ID);

  const stamp = backup.exportedAt.slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="ml-ai-manager-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
