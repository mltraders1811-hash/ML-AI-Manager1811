import { google } from "googleapis";

export class DriveFetchError extends Error {}

export type DriveBackupFile = {
  id: string;
  name: string;
  modifiedTime: string;
};

function getAuth(serviceAccountJson: string) {
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (e) {
    throw new DriveFetchError(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${(e as Error).message}`);
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

/**
 * Finds the most-recently-modified .vyb file in the given Drive folder.
 * The folder must be shared with the service account's client_email as
 * at least a Viewer.
 */
export async function findLatestBackup(
  serviceAccountJson: string,
  folderId: string,
): Promise<DriveBackupFile | null> {
  const auth = getAuth(serviceAccountJson);
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and name contains '.vyb'`,
    fields: "files(id, name, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const file = res.data.files?.[0];
  if (!file || !file.id || !file.name || !file.modifiedTime) return null;
  return { id: file.id, name: file.name, modifiedTime: file.modifiedTime };
}

/** Downloads a Drive file's raw bytes. */
export async function downloadFile(serviceAccountJson: string, fileId: string): Promise<Buffer> {
  const auth = getAuth(serviceAccountJson);
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(res.data as ArrayBuffer);
}
