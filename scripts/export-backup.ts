// Writes the app-owned data (the part a Vyapar re-sync cannot rebuild) to a
// JSON file. Run weekly by .github/workflows/backup.yml, which keeps the
// result as a downloadable artifact.
//
//   npm run backup -- ./backup.json
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

import { prisma } from "../src/lib/prisma";
import { buildBackup } from "../src/lib/backup";

async function main() {
  const companyId = process.env.DEFAULT_COMPANY_ID;
  if (!companyId) throw new Error("DEFAULT_COMPANY_ID is required");

  const outPath = process.argv[2] ?? "backup.json";
  const backup = await buildBackup(companyId);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(backup, null, 2));

  console.log(`[backup] wrote ${outPath}`);
  console.log(`[backup] ${JSON.stringify(backup.counts)}`);

  // An empty export usually means a misconfigured DATABASE_URL pointing at
  // the wrong database - worth failing loudly rather than quietly archiving
  // an empty file every week.
  const total = Object.values(backup.counts).reduce((s, n) => s + n, 0);
  if (total === 0) {
    throw new Error("Backup contains no records at all - check DATABASE_URL and DEFAULT_COMPANY_ID");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[backup] FAILED:", err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
