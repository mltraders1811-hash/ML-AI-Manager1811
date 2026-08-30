import { timingSafeEqual } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { ingestAlert } from "@/lib/bank/alertService";
import { importStatement } from "@/lib/bank/importService";
import { StatementParseError } from "@/lib/bank/types";
import { getEnv } from "@/lib/env";

// The way in for everything that isn't the Drive folder or the phone's file
// picker: an SMS forwarding app on the owner's phone, an email-forwarding
// rule, a laptop cron job posting the statement it just downloaded.
//
// Not behind the admin session - a forwarding app has no way to log in - so
// it is behind a bearer token instead, and does nothing at all until
// BANK_INGEST_TOKEN is set. The token may be sent as an Authorization
// header, an X-Bank-Token header, or a ?token= query parameter, because the
// simplest SMS forwarders can only do one of the three.

const MAX_TEXT_CHARS = 4000;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function tokenFrom(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const header = req.headers.get("x-bank-token");
  if (header) return header.trim();
  return req.nextUrl.searchParams.get("token");
}

/** Constant-time, so a wrong token can't be found one character at a time. */
function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type Authorised = { ok: true; companyId: string; accountsLast4: string[] } | { ok: false; response: NextResponse };

function authorise(req: NextRequest): Authorised {
  const env = getEnv();
  if (!env.BANK_INGEST_TOKEN) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forwarding isn't set up. Add BANK_INGEST_TOKEN in Vercel to enable this endpoint." },
        { status: 501 },
      ),
    };
  }
  const given = tokenFrom(req);
  if (!given || !tokenMatches(given, env.BANK_INGEST_TOKEN)) {
    return { ok: false, response: NextResponse.json({ error: "Bad token" }, { status: 401 }) };
  }
  return {
    ok: true,
    companyId: env.DEFAULT_COMPANY_ID,
    accountsLast4: (env.BANK_ALERT_ACCOUNTS ?? "")
      .split(",")
      .map((s) => s.replace(/\D/g, "").slice(-4))
      .filter(Boolean),
  };
}

/** A setup check: paste the URL with the token into a browser and see it work. */
export async function GET(req: NextRequest) {
  const auth = authorise(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ ok: true, tracking: auth.accountsLast4.length ? auth.accountsLast4 : "all accounts" });
}

/** Pulls the message text out of whatever shape the forwarder posts. */
function pickText(payload: Record<string, unknown>): string | null {
  for (const key of ["text", "message", "body", "msg", "sms", "content"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickSender(payload: Record<string, unknown>): string | null {
  for (const key of ["sender", "from", "address", "originator", "sender_id"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function POST(req: NextRequest) {
  const auth = authorise(req);
  if (!auth.ok) return auth.response;

  try {
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof File) {
        if (file.size > MAX_UPLOAD_BYTES) {
          return NextResponse.json({ error: "That file is bigger than 15MB" }, { status: 413 });
        }
        const outcome = await importStatement({
          companyId: auth.companyId,
          filename: file.name || "statement.csv",
          bytes: Buffer.from(await file.arrayBuffer()),
          source: "API",
        });
        return NextResponse.json({ kind: "statement", ...outcome });
      }
      // A form post with no file is a forwarded message in form fields.
      const fields = Object.fromEntries(form.entries()) as Record<string, unknown>;
      return alertResponse(auth, fields, req);
    }

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const fields = Object.fromEntries(new URLSearchParams(await req.text()).entries()) as Record<string, unknown>;
      return alertResponse(auth, fields, req);
    }

    if (contentType.includes("application/json")) {
      const payload = (await req.json()) as Record<string, unknown>;
      return alertResponse(auth, payload, req);
    }

    // Plain text: the whole body is the message.
    const body = (await req.text()).trim();
    return alertResponse(auth, { text: body }, req);
  } catch (err) {
    if (err instanceof StatementParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

async function alertResponse(
  auth: { companyId: string; accountsLast4: string[] },
  payload: Record<string, unknown>,
  req: NextRequest,
): Promise<NextResponse> {
  const text = pickText(payload);
  if (!text) {
    return NextResponse.json({ error: "No message text in the request" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json({ error: "Message too long to be a bank alert" }, { status: 413 });
  }

  const receivedRaw = payload["receivedAt"] ?? payload["received_at"] ?? payload["timestamp"];
  const receivedAt = typeof receivedRaw === "string" || typeof receivedRaw === "number" ? new Date(receivedRaw) : undefined;

  const result = await ingestAlert({
    companyId: auth.companyId,
    text,
    sender: pickSender(payload) ?? req.nextUrl.searchParams.get("sender"),
    receivedAt: receivedAt && !Number.isNaN(receivedAt.getTime()) ? receivedAt : undefined,
    accountsLast4: auth.accountsLast4,
  });

  // Always 200, including for a message that was ignored: a forwarding app
  // that sees an error will keep retrying the same promotional SMS for ever.
  // What happened is in the body, and in the alert log behind the app.
  return NextResponse.json({ kind: "alert", ...result });
}
