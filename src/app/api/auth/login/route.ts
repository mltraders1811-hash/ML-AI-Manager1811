import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { usernameMatches, verifyPassword } from "@/lib/password";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs"; // scrypt-based password check needs Node's crypto

const bodySchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  const { ADMIN_USERNAME, ADMIN_PASSWORD_HASH } = getEnv();
  const validUsername = usernameMatches(parsed.data.username, ADMIN_USERNAME);
  const validPassword = verifyPassword(parsed.data.password, ADMIN_PASSWORD_HASH);
  if (!validUsername || !validPassword) {
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
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
