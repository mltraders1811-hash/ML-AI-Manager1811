"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { getBankSms, isNativeApp, type BankSmsStatus } from "@/lib/native";

// Setting up SMS forwarding, done from inside the app so nothing has to be
// typed on a phone keyboard: the screen is already signed in, so it fetches
// the endpoint and token from the server and hands them straight to the
// native side.

const SAMPLE_SMS =
  "Dear Customer, Acct XX1811 is credited with Rs 1.00 on 01-01-26 from TEST PAYER. UPI:000000000001-ICICI Bank.";

function timeAgo(millis: number): string {
  if (!millis) return "never";
  const mins = Math.round((Date.now() - millis) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Step({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
            done ? "bg-brand text-white" : "bg-neutral-200 text-neutral-600"
          }`}
        >
          {done ? "✓" : number}
        </span>
        <h2 className="text-sm font-bold text-neutral-900">{title}</h2>
      </div>
      <div className="mt-3 space-y-3 text-sm text-neutral-600">{children}</div>
    </section>
  );
}

export function AndroidSettingsClient() {
  const [native, setNative] = useState<boolean | null>(null);
  const [status, setStatus] = useState<BankSmsStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    const plugin = await getBankSms();
    if (!plugin) return;
    try {
      setStatus(await plugin.getStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the app's status");
    }
  }, []);

  useEffect(() => {
    // Only known once the bridge has been injected, so it is read on mount
    // rather than during render.
    setNative(isNativeApp());
    void refresh();
  }, [refresh]);

  async function run(label: string, action: (plugin: NonNullable<Awaited<ReturnType<typeof getBankSms>>>) => Promise<BankSmsStatus>) {
    const plugin = await getBankSms();
    if (!plugin) return;
    setBusy(label);
    setError("");
    setNote("");
    try {
      setStatus(await action(plugin));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy("");
    }
  }

  async function connect() {
    setBusy("connect");
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/bank/ingest-config");
      const config = await res.json();
      if (!res.ok) throw new Error(config.error ?? "Couldn't read the settings from the server");

      const plugin = await getBankSms();
      if (!plugin) throw new Error("This only works inside the Android app");
      setStatus(await plugin.configure(config));
      setNote("Phone jud gaya. Ab is account ke bank SMS apne aap app me aayenge.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect this phone");
    } finally {
      setBusy("");
    }
  }

  if (native === false) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-xl font-bold text-neutral-900">Android app</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Yeh screen sirf Android app ke andar kaam karti hai. Browser me SMS padhne ki ijazat nahi milti - isi liye app
          banayi gayi hai.
        </p>
        <p className="mt-3 text-sm text-neutral-600">
          App install karne ka tarika <code className="rounded bg-neutral-100 px-1">docs/android.md</code> me likha hai.
          Browser me bank statement upload karke bhi kaam chal jayega.
        </p>
        <Link href="/bank" className="mt-5 inline-block rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600">
          Bank screen
        </Link>
      </main>
    );
  }

  const permissionDone = status?.permissionGranted === true;
  const configuredDone = status?.configured === true;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pb-24">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Bank SMS</h1>
          <p className="text-xs text-neutral-500">Payment aate hi app me - statement ka intezaar nahi</p>
        </div>
        <Link href="/bank" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600">
          Bank
        </Link>
      </header>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}
      {note ? (
        <p className="mb-4 rounded-xl border border-brand/30 bg-brand-light px-4 py-3 text-sm text-brand-dark">{note}</p>
      ) : null}

      <div className="space-y-3">
        <Step number={1} title="SMS padhne ki ijazat" done={permissionDone}>
          <p>
            App ko sirf bank ke message chahiye. Jo message aapke bank aur account se nahi hai, wo phone se bahar jata hi
            nahi.
          </p>
          <button
            type="button"
            disabled={busy !== "" || permissionDone}
            onClick={() => run("permission", (p) => p.requestPermission())}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {permissionDone ? "Ijazat mil gayi" : busy === "permission" ? "Puchh rahe hain…" : "Ijazat dein"}
          </button>
        </Step>

        <Step number={2} title="Is phone ko jodein" done={configuredDone}>
          <p>Server se address aur token khud aa jayenge - kuch type nahi karna.</p>
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => void connect()}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {busy === "connect" ? "Jod rahe hain…" : configuredDone ? "Dobara jodein" : "Jodein"}
          </button>
          {status?.configured ? (
            <p className="text-xs text-neutral-500">
              {status.banks ? `Sirf ${status.banks}` : "Har bank"} · {status.accounts ? `A/c ••${status.accounts}` : "har account"}
            </p>
          ) : null}
        </Step>

        <Step number={3} title="Jaanch lein" done={(status?.forwardedCount ?? 0) > 0}>
          <p>Ek nakli message bhejkar dekhein ki poora rasta kaam kar raha hai. Bank screen par ₹1 ka entry aayega.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== "" || !configuredDone}
              onClick={() => run("test", (p) => p.sendTest({ text: SAMPLE_SMS, sender: "AD-ICICIB" }))}
              className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-60"
            >
              {busy === "test" ? "Bhej rahe hain…" : "Test message"}
            </button>
            <button
              type="button"
              disabled={busy !== "" || !configuredDone || !status?.canReadInbox}
              onClick={() => run("catchup", (p) => p.catchUp({ days: 7 }))}
              className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-60"
            >
              {busy === "catchup" ? "Padh rahe hain…" : "Purane 7 din ke SMS padhein"}
            </button>
          </div>
          {status?.scanned !== undefined ? (
            <p className="text-xs text-neutral-500">
              {status.scanned} message dekhe, {status.queued} bheje gaye. Jo pehle aa chuke hain wo dobara nahi jodenge.
            </p>
          ) : null}
        </Step>
      </div>

      {status ? (
        <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Abhi tak</h2>
          <dl className="mt-2 space-y-1 text-neutral-600">
            <div className="flex justify-between gap-3">
              <dt>Bheje gaye message</dt>
              <dd className="font-semibold text-neutral-900">{status.forwardedCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Aakhri message</dt>
              <dd className="font-semibold text-neutral-900">{timeAgo(status.lastForwardedAt)}</dd>
            </div>
            {status.lastResult ? (
              <div className="flex justify-between gap-3">
                <dt>Aakhri natija</dt>
                <dd className={status.lastResult === "ok" ? "text-brand" : "text-overdue"}>{status.lastResult}</dd>
              </div>
            ) : null}
          </dl>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 text-xs font-semibold text-brand"
          >
            Refresh
          </button>
        </section>
      ) : null}
    </main>
  );
}
