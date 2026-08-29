import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { isPushConfigured, sendToAll } from "@/lib/push";

export const runtime = "nodejs";

/**
 * Sends a notification right now, to every device that has opted in.
 *
 * Push has a lot of places to fail silently - browser permission, an
 * unregistered service worker, a key mismatch between Vercel and the phone's
 * stored subscription. Without a way to provoke one on demand, the first
 * evidence that any of that is wrong would be a digest that never arrives,
 * which looks identical to "nothing was overdue".
 */
export async function POST() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "Notifications aren't set up on the server yet (VAPID keys missing)." },
      { status: 501 },
    );
  }

  const result = await sendToAll(DEFAULT_COMPANY_ID, {
    title: "Test notification",
    body: "Sab theek hai - notifications chaalu hain.",
    url: "/",
    tag: "test",
  });

  if (result.sent === 0) {
    return NextResponse.json(
      {
        error:
          result.removed > 0
            ? "This device's subscription had expired, so it was removed. Turn notifications off and on again."
            : "No device is signed up for notifications yet.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
