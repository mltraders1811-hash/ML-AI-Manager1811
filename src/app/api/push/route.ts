import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { deleteSubscription, getVapidPublicKey, saveSubscription } from "@/lib/push";

// web-push and the Prisma client both need Node APIs.
export const runtime = "nodejs";

/** What the browser needs before it can subscribe, plus the current state
 * so the toggle can render correctly on first paint. */
export async function GET() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const publicKey = getVapidPublicKey();
  const deviceCount = publicKey
    ? await prisma.pushSubscription.count({ where: { companyId: DEFAULT_COMPANY_ID } })
    : 0;

  return NextResponse.json({ configured: publicKey !== null, publicKey, deviceCount });
}

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  label: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  if (!getVapidPublicKey()) {
    return NextResponse.json({ error: "Notifications aren't set up on the server yet." }, { status: 501 });
  }

  const parsed = subscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That doesn't look like a push subscription." }, { status: 400 });
  }

  const { label, ...sub } = parsed.data;
  await saveSubscription(DEFAULT_COMPANY_ID, sub, label);
  return NextResponse.json({ ok: true });
}

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

export async function DELETE(req: NextRequest) {
  const parsed = unsubscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }
  await deleteSubscription(parsed.data.endpoint);
  return NextResponse.json({ ok: true });
}
