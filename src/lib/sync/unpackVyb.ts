import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import AdmZip from "adm-zip";

export class UnpackError extends Error {}

/**
 * A .vyb file is a plain ZIP archive containing one .vyp SQLite database.
 * Extracts it to a fresh temp directory and returns the path to the .vyp
 * file. Caller is responsible for calling cleanupExtractDir() when done.
 */
export function unpackVyb(vybBytes: Buffer): { vypPath: string; extractDir: string } {
  const extractDir = mkdtempSync(join(tmpdir(), "vyb-"));
  try {
    const zip = new AdmZip(vybBytes);
    zip.extractAllTo(extractDir, true);
  } catch (e) {
    rmSync(extractDir, { recursive: true, force: true });
    throw new UnpackError(`Failed to unzip .vyb file: ${(e as Error).message}`);
  }

  const vypFile = findVypFile(extractDir);
  if (!vypFile) {
    rmSync(extractDir, { recursive: true, force: true });
    throw new UnpackError("No .vyp file found inside the .vyb archive");
  }

  return { vypPath: vypFile, extractDir };
}

function findVypFile(dir: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findVypFile(full);
      if (nested) return nested;
    } else if (entry.name.toLowerCase().endsWith(".vyp")) {
      return full;
    }
  }
  return null;
}

export function cleanupExtractDir(extractDir: string): void {
  rmSync(extractDir, { recursive: true, force: true });
}
