#!/usr/bin/env node
// Generates the value for ADMIN_PASSCODE_HASH in .env.
// Usage: node scripts/hash-passcode.mjs <your-passcode>
import { randomBytes, scryptSync } from "node:crypto";

const plain = process.argv[2];
if (!plain) {
  console.error("Usage: node scripts/hash-passcode.mjs <your-passcode>");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(plain, salt, 64);
console.log(`${salt.toString("hex")}:${hash.toString("hex")}`);
