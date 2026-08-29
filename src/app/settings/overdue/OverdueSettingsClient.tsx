"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Settings = {
  creditDays: number;
  reminderTemplate: string;
  defaultReminderTemplate: string;
  defaultCreditDays: number;
  placeholders: string[];
};

export function OverdueSettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [creditDays, setCreditDays] = useState("");
  const [template, setTemplate] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/overdue/settings")
      .then((r) => r.json())
      .then((s: Settings) => {
        setSettings(s);
        setCreditDays(String(s.creditDays));
        setTemplate(s.reminderTemplate);
      })
      .catch(() => setError("Couldn't load settings"));
  }, []);

  async function save() {
    setSaving(true);
    setStatus("");
    setError("");
    try {
      const n = Number(creditDays);
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        throw new Error("Credit days must be a whole number between 0 and 365");
      }
      const res = await fetch("/api/overdue/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditDays: n, reminderTemplate: template }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't save");
      setTemplate(body.reminderTemplate);
      setStatus("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Overdue Settings</h1>
          <p className="text-xs text-neutral-500">Default credit period and reminder wording</p>
        </div>
        <Link
          href="/overdue"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
        >
          Back
        </Link>
      </header>

      <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-semibold text-neutral-800">Default credit period (days)</label>
        <p className="mb-2 mt-1 text-xs text-neutral-500">
          How long after a bill date before it counts as overdue. Used for any customer without their own credit
          period set in the phone book.
        </p>
        <input
          value={creditDays}
          onChange={(e) => setCreditDays(e.target.value)}
          inputMode="numeric"
          className="w-32 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </section>

      <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-semibold text-neutral-800">WhatsApp reminder message</label>
        <p className="mb-2 mt-1 text-xs text-neutral-500">
          These placeholders get filled in per customer:{" "}
          {settings?.placeholders.map((p, i) => (
            <span key={p}>
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px]">{`{${p}}`}</code>
              {i < (settings?.placeholders.length ?? 0) - 1 ? " " : ""}
            </span>
          ))}
        </p>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={10}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {settings ? (
          <button
            onClick={() => setTemplate(settings.defaultReminderTemplate)}
            className="mt-2 text-xs font-semibold text-neutral-500 underline"
          >
            Reset to default wording
          </button>
        ) : null}
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !settings}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {status ? <span className="text-sm text-neutral-500">{status}</span> : null}
        {error ? <span className="text-sm text-overdue">{error}</span> : null}
      </div>
    </main>
  );
}
