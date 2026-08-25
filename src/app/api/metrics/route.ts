import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { getLastSyncRun, getQuickMetrics } from "@/lib/metrics";

export async function GET() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const [metrics, lastSync] = await Promise.all([
    getQuickMetrics(DEFAULT_COMPANY_ID),
    getLastSyncRun(DEFAULT_COMPANY_ID),
  ]);

  return NextResponse.json({
    metrics,
    lastSync: lastSync
      ? {
          startedAt: lastSync.startedAt,
          finishedAt: lastSync.finishedAt,
          status: lastSync.status,
          sourceFileName: lastSync.sourceFileName,
        }
      : null,
  });
}
