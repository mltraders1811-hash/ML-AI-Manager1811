// Diagnostic tool: prints every table and its columns (with a sample row)
// from a real Vyapar backup, so column mapping guesses in
// src/lib/sync/columnMap.ts can be verified/corrected before going live.
//
// Usage:
//   npm run inspect-vyp -- /path/to/backup.vyb   (or a raw .vyp file)
import { readFileSync } from "fs";

import Database from "better-sqlite3";

import { cleanupExtractDir, unpackVyb } from "../src/lib/sync/unpackVyb";

function inspect(vypPath: string) {
  const db = new Database(vypPath, { readonly: true, fileMustExist: true });
  const tables = (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map(
    (r) => r.name,
  );

  console.log(`Found ${tables.length} table(s):\n`);
  for (const table of tables.sort()) {
    const columns = db.prepare(`pragma table_info("${table}")`).all() as { name: string; type: string }[];
    const count = (db.prepare(`select count(*) as n from "${table}"`).get() as { n: number }).n;
    console.log(`--- ${table} (${count} rows) ---`);
    console.log(columns.map((c) => `${c.name} (${c.type})`).join(", "));
    if (count > 0) {
      const sample = db.prepare(`select * from "${table}" limit 1`).get();
      console.log("sample row:", JSON.stringify(sample, null, 2));
    }
    console.log("");
  }
  db.close();
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npm run inspect-vyp -- /path/to/backup.vyb");
    process.exit(1);
  }

  if (path.toLowerCase().endsWith(".vyp")) {
    inspect(path);
    return;
  }

  // Assume it's a .vyb (zip) file.
  const bytes = readFileSync(path);
  const { vypPath, extractDir } = unpackVyb(bytes);
  try {
    inspect(vypPath);
  } finally {
    cleanupExtractDir(extractDir);
  }
}

main();
