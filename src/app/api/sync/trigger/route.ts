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
    return NextResponse.json({ error: "Couldn't start the sync. Try again in a bit." }, { status: 502 });
  }
}
