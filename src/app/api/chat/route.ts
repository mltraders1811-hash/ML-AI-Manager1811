import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getEnv } from "@/lib/env";
import { runChat } from "@/lib/ai/chat";

export const runtime = "nodejs";

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) }))
    .min(1)
    .max(30),
});

export async function POST(req: NextRequest) {
  const { DEFAULT_COMPANY_ID, ANTHROPIC_API_KEY } = getEnv();
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI chat is not configured (ANTHROPIC_API_KEY is missing)" }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const reply = await runChat(DEFAULT_COMPANY_ID, ANTHROPIC_API_KEY, parsed.data.messages);
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[chat] failed", err);
    return NextResponse.json({ error: "AI chat request failed" }, { status: 502 });
  }
}
