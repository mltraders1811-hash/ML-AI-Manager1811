// The automatic half of "connect the bank": statements the owner never has
// to upload.
//
// No Indian bank hands a small shop a transaction API, and the account
// aggregator route needs a licensed intermediary - so the practical
// connection is the one the banks themselves already offer: a statement
// that arrives on a schedule (net-banking's daily/weekly emailed statement,
// or a scheduled export) and lands in a Google Drive folder. This job picks
// up whatever is in that folder each morning, right after the Vyapar sync,
// and reconciles it.
//
// Runs from the sync script only (scripts/run-sync.ts), never from a Next
// route: googleapis must stay out of the serverless bundle - the same
// reason the Vyapar sync lives there.
import { prisma } from "@/lib/prisma";
import { downloadFile, listFilesInFolderTree } from "@/lib/sync/driveClient";

import { alreadyImported, importStatement, type ImportOutcome } from "./importService";
import { StatementParseError } from "./types";

const STATEMENT_EXTENSIONS = [".csv", ".xlsx", ".xlsm", ".txt"];
/** Enough for a folder holding a year of monthly statements. */
const MAX_FILES = 30;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export type DriveImportSummary = {
  filesSeen: number;
  filesSkipped: number;
  imports: ImportOutcome[];
  errors: string[];
};

/**
 * A file that can't be read is recorded as a failed import rather than
 * retried every morning for ever - the folder will collect the odd PDF or
 * password-protected export, and each one would otherwise be a fresh error
 * in every sync from now on.
 */
async function recordUnreadable(companyId: string, file: { id: string; name: string }, message: string) {
  await prisma.bankStatementImport.create({
    data: {
      companyId,
      source: "DRIVE",
      filename: file.name,
      fileSize: 0,
      externalId: file.id,
      errorMessage: message,
    },
  });
}

export async function importStatementsFromDrive(
  companyId: string,
  serviceAccountJson: string,
  folderId: string,
): Promise<DriveImportSummary> {
  const files = await listFilesInFolderTree(serviceAccountJson, folderId, {
    extensions: STATEMENT_EXTENSIONS,
    maxFiles: MAX_FILES,
  });

  const summary: DriveImportSummary = { filesSeen: files.length, filesSkipped: 0, imports: [], errors: [] };

  for (const file of files) {
    if (await alreadyImported(companyId, file.id)) {
      summary.filesSkipped++;
      continue;
    }

    try {
      const bytes = await downloadFile(serviceAccountJson, file.id);
      if (bytes.length > MAX_FILE_BYTES) {
        await recordUnreadable(companyId, file, "File is larger than 15MB");
        summary.errors.push(`${file.name}: larger than 15MB, skipped`);
        continue;
      }
      summary.imports.push(
        await importStatement({
          companyId,
          filename: file.name,
          bytes,
          source: "DRIVE",
          externalId: file.id,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${file.name}: ${message}`);
      // A parse failure is about the file and will never succeed; a network
      // or database failure might, so only the former is written off.
      if (err instanceof StatementParseError) {
        try {
          await recordUnreadable(companyId, file, message);
        } catch {
          // Losing the marker only means retrying this file tomorrow.
        }
      }
    }
  }

  return summary;
}
