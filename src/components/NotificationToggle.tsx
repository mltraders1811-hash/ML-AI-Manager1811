"use client";

import { useCallback, useEffect, useState } from "react";

type Config = { configured: boolean; publicKey: string | null; deviceCount: number };

/** The VAPID key travels as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** A name for the device, so a phone and a laptop are distinguishable in the
 * device count without storing the full user-agent string. */
function describeDevice(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "Android phone";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/windows/i.test(ua)) return "Windows PC";
  if (/mac/i.test(ua)) return "Mac";
  return "Browser";
}

function isIosSafari(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function NotificationToggle() {
  const [config, setConfig] = useState<Config | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState<"yes" | "needs-install" | "no">("yes");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/push");
    setConfig(await res.json());
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // On iOS, push exists only once the app is on the home screen. That's
      // a fixable state, not an unsupported browser, and saying so is the
      // difference between the owner installing the app and giving up.
      setSupported(isIosSafari() && !isStandalone() ? "needs-install" : "no");
      return;
    }
    refresh().catch(() => setError("Couldn't check notification settings."));
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEnabled(sub !== null))
      .catch(() => {});
  }, [refresh]);

  async function enable() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (!config?.publicKey) throw new Error("Server has no notification key configured.");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error(
          permission === "denied"
            ? "Notifications blocked. Browser settings mein is site ke liye notifications allow karein."
            : "Notification permission wasn't granted.",
        );
      }

      const reg = await navigator.serviceWorker.ready;
      // An existing subscription made with a different key can't be reused -
      // the push service would reject every send with a 403. Dropping it and
      // re-subscribing is the only recovery, and it's invisible to the user.
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey) as BufferSource,
      });

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
      if (!json.endpoint || !json.keys) throw new Error("The browser returned an unusable subscription.");

      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label: describeDevice() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't save the subscription.");

      setEnabled(true);
      setStatus("Notifications chaalu. Roz subah sync ke baad summary aayegi.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn notifications on.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Tell the server first: if unsubscribing succeeds and the delete
        // fails, the row lives on and every future digest is sent to an
        // endpoint that will never deliver.
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setEnabled(false);
      setStatus("Notifications band kar diye.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn notifications off.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't send the test.");
      setStatus(`Test bheja - ${body.sent} device par.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the test.");
    } finally {
      setBusy(false);
    }
  }

  if (supported === "needs-install") {
    return (
      <Card>
        <p className="text-sm text-neutral-700">
          iPhone par notifications sirf tab kaam karte hain jab app home screen par lagayi ho.
          Safari mein Share ▸ <strong>Add to Home Screen</strong> karein, phir home screen wale icon
          se app kholkar yahan wapas aayein.
        </p>
      </Card>
    );
  }

  if (supported === "no") {
    return (
      <Card>
        <p className="text-sm text-neutral-700">Yeh browser notifications support nahi karta.</p>
      </Card>
    );
  }

  if (config && !config.configured) {
    return (
      <Card>
        <p className="text-sm text-neutral-700">
          Notifications abhi server par set nahi hain. Vercel mein <code>VAPID_PUBLIC_KEY</code> aur{" "}
          <code>VAPID_PRIVATE_KEY</code> add karne ke baad yeh option chaalu ho jayega.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-neutral-900">Roz ka overdue alert</p>
          <p className="mt-1 text-xs text-neutral-500">
            Subah sync ke baad ek notification: kitna paisa {""}
            overdue hai aur kin parties ka. Kuch overdue na ho to koi notification nahi aati.
          </p>
        </div>
        <button
          onClick={enabled ? disable : enable}
          disabled={busy || !config}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
            enabled ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-100" : "bg-brand text-white"
          }`}
        >
          {busy ? "..." : enabled ? "Band karein" : "Chaalu karein"}
        </button>
      </div>

      {config ? (
        <p className="mt-3 text-xs text-neutral-500">
          {config.deviceCount === 0
            ? "Abhi koi device signed up nahi hai."
            : `${config.deviceCount} device par notifications jaate hain.`}
          {enabled ? " Is device par chaalu hai." : ""}
        </p>
      ) : null}

      {enabled ? (
        <button
          onClick={sendTest}
          disabled={busy}
          className="mt-3 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50"
        >
          Test notification bhejein
        </button>
      ) : null}

      {status ? <p className="mt-3 text-xs font-medium text-brand">{status}</p> : null}
      {error ? <p className="mt-3 text-xs font-medium text-red-600">{error}</p> : null}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">{children}</div>;
}
