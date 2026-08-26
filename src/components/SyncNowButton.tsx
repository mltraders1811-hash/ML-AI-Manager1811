"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Status = "idle" | "loading" | "started" | "error";

export function SyncNowButton() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/sync/trigger", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Couldn't start the sync.");
        return;
      }
      setStatus("started");
      setMessage("Sync started - this takes about a minute. Refresh to see updated numbers.");
      // Give the GitHub Actions job time to finish, then refresh the
      // dashboard's server-fetched data automatically.
      setTimeout(() => router.refresh(), 60_000);
    } catch {
      setStatus("error");
      setMessage("Couldn't reach the server. Check your connection and try again.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={status === "loading"}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50"
      >
        {status === "loading" ? "Starting sync..." : "Sync Now"}
      </button>
      {message && (
        <p className={`max-w-[220px] text-right text-xs ${status === "error" ? "text-red-600" : "text-neutral-500"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
