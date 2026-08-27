import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// Node-only (uses the `crypto` module, not Web Crypto) - only ever imported
// from the login API route, which runs on the Node.js runtime. Never import
// this from src/middleware.ts or anything else that might run on Edge.
//
// Hash format: "<saltHex>:<hashHex>", matching scripts/hash-password.mjs.

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(plain, salt, 64);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Username isn't the secret (the password is), but a constant-time
 * comparison costs nothing and avoids leaking length via short-circuiting. */
export function usernameMatches(input: string, expected: string): boolean {
  const a = Buffer.from(input.trim().toLowerCase());
  const b = Buffer.from(expected.trim().toLowerCase());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
