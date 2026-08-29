import { NextResponse } from "next/server";

import { isGithubSyncConfigured, triggerGithubSync } from "@/lib/githubSync";

export async function POST() {
  if (!isGithubSyncConfigured()) {
    return NextResponse.json(
      { error: "Sync-now isn't set up yet. Add GITHUB_SYNC_TOKEN in Vercel to enable this button." },
      { status: 501 },
    );
  }

  try {
    await triggerGithubSync();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    // Surface GitHub's own message rather than a generic one. This route is
    // behind the admin login and there's exactly one admin (the owner), so
    // the only person who can see this is someone already entitled to the
    // deployment's diagnostics - and without it, a misconfigured token is
    // indistinguishable from GitHub being down.
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Couldn't start the sync. ${detail}` }, { status: 502 });
  }
}
