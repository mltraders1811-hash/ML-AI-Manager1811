// Triggers the existing daily-sync GitHub Actions workflow on demand, from
// a button in the dashboard. The sync itself still runs in GitHub Actions
// (not here) - see the architecture note in syncEngine.ts/README about why
// better-sqlite3/adm-zip/googleapis don't belong in a Vercel bundle.

// This deployment always dispatches its own repo's workflow, so the
// owner/repo are fixed constants rather than another env var to configure -
// update these if the repo is ever renamed or forked.
const REPO_OWNER = "mltraders1811-hash";
const REPO_NAME = "ML-AI-Manager1811";
const WORKFLOW_FILE = "daily-sync.yml";

export function isGithubSyncConfigured(): boolean {
  return !!process.env.GITHUB_SYNC_TOKEN;
}

/** Fires the daily-sync workflow via the GitHub API. The workflow runs
 * asynchronously - a 204 here just means GitHub accepted the request, not
 * that the sync has finished (that takes roughly a minute). */
export async function triggerGithubSync(): Promise<void> {
  const token = process.env.GITHUB_SYNC_TOKEN;
  if (!token) {
    throw new Error("GITHUB_SYNC_TOKEN is not configured on this deployment");
  }

  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API returned ${res.status}: ${body || res.statusText}`);
  }
}
