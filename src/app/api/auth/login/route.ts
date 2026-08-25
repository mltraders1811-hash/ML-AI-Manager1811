import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifyPasscode } from "@/lib/passcode";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs"; // scrypt-based passcode check needs Node's crypto

const bodySchema = z.object({ passcode: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Passcode is required" }, { status: 400 });
  }

  const { ADMIN_PASSCODE_HASH } = getEnv();
  if (!verifyPasscode(parsed.data.passcode, ADMIN_PASSCODE_HASH)) {
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return res;
}
