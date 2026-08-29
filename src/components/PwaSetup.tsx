"use client";

import { useEffect, useState } from "react";

/** Chrome's install event isn't in the DOM lib yet. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "mlm.installBannerDismissed";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ reports itself as a Mac, and the touch points are the only
  // thing that gives it away.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own, non-standard flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Registers the service worker and offers to install the app.
 *
 * Android hands us a real install prompt; iOS has no such API, so the only
 * honest thing there is to tell the owner which two taps to make. Both
 * banners disappear for good once dismissed, and never appear at all once
 * the app is already installed.
 */
export function PwaSetup() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registering after load keeps the worker's own fetches from competing
    // with the page's on a slow connection.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("Service worker registration failed", err);
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISSED_KEY) === "1") return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's own mini-infobar; we place our own
      setInstallEvent(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // Safari never fires that event, so on iOS the hint is all there is.
    if (isIos()) setShowIosHint(true);

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setInstallEvent(null);
    setShowIosHint(false);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    // The event can only be used once, whatever the answer.
    setInstallEvent(null);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  if (!installEvent && !showIosHint) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-lg">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">
          ML
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900">Phone par app ki tarah lagayein</p>
          <p className="text-xs text-neutral-500">
            {installEvent
              ? "Home screen par icon aa jayega - browser kholne ki zaroorat nahi."
              : "Share button dabayein, phir “Add to Home Screen” chunein."}
          </p>
        </div>
        {installEvent ? (
          <button
            onClick={install}
            className="shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
          >
            Install
          </button>
        ) : null}
        <button
          onClick={dismiss}
          aria-label="Band karein"
          className="shrink-0 rounded-lg px-2 py-2 text-xs font-semibold text-neutral-400 hover:text-neutral-600"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
