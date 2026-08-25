import { getEnv } from "@/lib/env";

// Session tokens only - kept free of Node-only imports (no `crypto` module)
// because this file is imported by src/middleware.ts, which runs on the
// Edge runtime. Uses Web Crypto (globalThis.crypto.subtle), which works
// identically in both Edge and Node.js runtimes. Passcode hashing (which
// does need Node's `crypto`) lives separately in src/lib/passcode.ts and is
// only ever imported from the login API route (Node.js runtime).

export const SESSION_COOKIE = "mlam_session";
const SESSION_TTL_SECONDS = 30 * 24 * 3600; // 30 days

function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function b64urlDecode(value: string): Uint8Array {
  // Uint8Array.from(...) copies into a plain ArrayBuffer-backed array,
  // sidestepping Buffer's pooled-allocator typing (ArrayBufferLike can be a
  // SharedArrayBuffer, which Web Crypto's BufferSource type rejects).
  return Uint8Array.from(Buffer.from(value, "base64url"));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken(): Promise<string> {
  const { SESSION_SECRET } = getEnv();
  const payload = { exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(SESSION_SECRET);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const { SESSION_SECRET } = getEnv();
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return false;

  const key = await hmacKey(SESSION_SECRET);
  // Cast needed because @types/node's Uint8Array<ArrayBufferLike> and
  // lib.dom's BufferSource (which wants ArrayBuffer specifically) disagree
  // as of TS 5.7 / @types/node 22 - the bytes themselves are fine.
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sigB64) as BufferSource,
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}
