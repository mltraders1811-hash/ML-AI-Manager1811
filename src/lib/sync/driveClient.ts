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

// Vyapar's Drive backup doesn't put .vyb files directly in the folder you
// connect - it files them into per-month subfolders ("08-2026", "09-2026",
// ...) and creates a new one on the 1st of each month. A search of just the
// top-level folder would therefore find nothing, and pointing straight at a
// month folder would silently go stale the moment the next month starts. So
// we search the folder AND its subfolders.
const MAX_SUBFOLDERS = 60; // ~5 years of month folders; bounds the query size
const PARENTS_PER_QUERY = 20; // keeps each `q` well under Drive's length limit

type Drive = ReturnType<typeof google.drive>;

async function listSubfolderIds(drive: Drive, folderId: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
      fields: "nextPageToken, files(id)",
      // Newest-touched first, so if we do hit MAX_SUBFOLDERS we keep the
      // folders most likely to hold the latest backup.
      orderBy: "modifiedTime desc",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      if (f.id) ids.push(f.id);
      if (ids.length >= MAX_SUBFOLDERS) return ids;
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return ids;
}

async function newestVybAmongParents(drive: Drive, parentIds: string[]): Promise<DriveBackupFile | null> {
  const parentClause = parentIds.map((id) => `'${id}' in parents`).join(" or ");
  const res = await drive.files.list({
    q: `(${parentClause}) and trashed = false and name contains '.vyb'`,
    fields: "files(id, name, modifiedTime)",
    orderBy: "modifiedTime desc",
    // A few, not one: Drive's `contains` is a loose match, so we filter for a
    // real .vyb extension below and want a couple of spares to fall back on.
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  for (const f of res.data.files ?? []) {
    if (!f.id || !f.name || !f.modifiedTime) continue;
    if (!f.name.toLowerCase().endsWith(".vyb")) continue;
    return { id: f.id, name: f.name, modifiedTime: f.modifiedTime };
  }
  return null;
}

/**
 * Finds the most-recently-modified .vyb file in the given Drive folder or
 * any of its immediate subfolders (see the note above on Vyapar's per-month
 * folders). The folder must be shared with the service account's
 * client_email as at least a Viewer; subfolders inherit that access.
 */
export async function findLatestBackup(
  serviceAccountJson: string,
  folderId: string,
): Promise<DriveBackupFile | null> {
  const auth = getAuth(serviceAccountJson);
  const drive = google.drive({ version: "v3", auth });

  const searchIds = [folderId, ...(await listSubfolderIds(drive, folderId))];

  let newest: DriveBackupFile | null = null;
  for (let i = 0; i < searchIds.length; i += PARENTS_PER_QUERY) {
    const candidate = await newestVybAmongParents(drive, searchIds.slice(i, i + PARENTS_PER_QUERY));
    if (candidate && (!newest || candidate.modifiedTime > newest.modifiedTime)) {
      newest = candidate;
    }
  }
  return newest;
}

/** Downloads a Drive file's raw bytes. */
export async function downloadFile(serviceAccountJson: string, fileId: string): Promise<Buffer> {
  const auth = getAuth(serviceAccountJson);
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(res.data as ArrayBuffer);
}
