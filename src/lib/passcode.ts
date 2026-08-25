import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// Node-only (uses the `crypto` module, not Web Crypto) - only ever imported
// from the login API route, which runs on the Node.js runtime. Never import
// this from src/middleware.ts or anything else that might run on Edge.
//
// Hash format: "<saltHex>:<hashHex>", matching scripts/hash-passcode.mjs.

export function hashPasscode(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPasscode(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(plain, salt, 64);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
