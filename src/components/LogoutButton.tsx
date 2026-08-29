"use client";

import { useRouter } from "next/navigation";

/**
 * Clearing the session cookie isn't enough once pages are cached offline:
 * the service worker would still serve the last dashboard to whoever picks
 * the phone up next. Dropping the caches is part of logging out.
 */
async function clearOfflineCopies() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHE" });
  } catch {
    // Best effort - a browser that refuses cache access still gets logged out.
  }
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        await clearOfflineCopies();
        router.replace("/login");
        router.refresh();
      }}
      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
    >
      Log out
    </button>
  );
}
