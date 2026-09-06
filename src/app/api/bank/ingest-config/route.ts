import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";

/**
 * What the Android app needs to forward bank SMS: where to post, and the
 * token to post with.
 *
 * This hands the ingest token to the browser, which is only reasonable
 * because of who can reach it: the route is behind the admin session (see
 * src/middleware.ts), there is exactly one admin, and that session already
 * allows everything the token allows and more - assigning payments,
 * uploading statements, posting an alert to the ingest endpoint by hand.
 * The alternative is typing a 44-character token on a phone keyboard, which
 * in practice means a shorter token.
 */
export async function GET(req: NextRequest) {
  const env = getEnv();

  if (!env.BANK_INGEST_TOKEN) {
    return NextResponse.json(
      { error: "Forwarding isn't set up. Add BANK_INGEST_TOKEN in Vercel, then reopen this screen." },
      { status: 501 },
    );
  }

  // Built from the request rather than configured, so a phone pointed at a
  // preview deployment configures itself for that deployment.
  const origin = req.nextUrl.origin;

  return NextResponse.json({
    endpoint: `${origin}/api/bank/ingest`,
    token: env.BANK_INGEST_TOKEN,
    banks: env.BANK_ALERT_BANKS ?? "",
    accounts: env.BANK_ALERT_ACCOUNTS ?? "",
  });
}
