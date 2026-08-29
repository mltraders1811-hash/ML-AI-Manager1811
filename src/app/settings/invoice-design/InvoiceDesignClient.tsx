"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Design = {
  businessName: string;
  addressLine: string | null;
  phone: string | null;
  gstin: string | null;
  accentColor: string;
  footerNote: string | null;
  showLineItems: boolean;
};

type Form = {
  businessName: string;
  addressLine: string;
  phone: string;
  gstin: string;
  accentColor: string;
  footerNote: string;
  showLineItems: boolean;
};

function toForm(d: Design): Form {
  return {
    businessName: d.businessName,
    addressLine: d.addressLine ?? "",
    phone: d.phone ?? "",
    gstin: d.gstin ?? "",
    accentColor: d.accentColor,
    footerNote: d.footerNote ?? "",
    showLineItems: d.showLineItems,
  };
}

export function InvoiceDesignClient({ sampleInvoiceId }: { sampleInvoiceId: string | null }) {
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/invoice-design")
      .then((r) => r.json())
      .then((d: Design) => setForm(toForm(d)))
      .catch(() => setError("Couldn't load settings"));
  }, []);

  async function save() {
    if (!form) return;
    setSaving(true);
    setStatus("");
    setError("");
    try {
      const res = await fetch("/api/settings/invoice-design", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: form.businessName,
          addressLine: form.addressLine,
          phone: form.phone,
          gstin: form.gstin,
          accentColor: form.accentColor,
          footerNote: form.footerNote,
          showLineItems: form.showLineItems,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't save");
      setStatus("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-sm text-neutral-500">{error || "Loading…"}</p>
      </main>
    );
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Invoice Design</h1>
          <p className="text-xs text-neutral-500">How your invoice PDFs look</p>
        </div>
        <Link
          href="/invoices"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
        >
          Back
        </Link>
      </header>

      <section className="mb-5 space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <label className="block">
          <span className="text-xs font-semibold text-neutral-600">Business name</span>
          <input
            value={form.businessName}
            onChange={(e) => set("businessName", e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-neutral-600">Address</span>
          <input
            value={form.addressLine}
            onChange={(e) => set("addressLine", e.target.value)}
            placeholder="Optional"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-neutral-600">Phone</span>
            <input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="Optional"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-neutral-600">GSTIN</span>
            <input
              value={form.gstin}
              onChange={(e) => set("gstin", e.target.value)}
              placeholder="Optional"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
        </div>
      </section>

      <section className="mb-5 space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <label className="block">
          <span className="text-xs font-semibold text-neutral-600">Accent colour</span>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="color"
              value={form.accentColor}
              onChange={(e) => set("accentColor", e.target.value)}
              className="h-10 w-14 cursor-pointer rounded border border-neutral-300"
            />
            <input
              value={form.accentColor}
              onChange={(e) => set("accentColor", e.target.value)}
              className="w-32 rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </label>

        <label className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            checked={form.showLineItems}
            onChange={(e) => set("showLineItems", e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm text-neutral-700">Show the item-by-item table</span>
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-neutral-600">Footer note</span>
          <input
            value={form.footerNote}
            onChange={(e) => set("footerNote", e.target.value)}
            placeholder="e.g. Thank you for your business."
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save design"}
        </button>
        {sampleInvoiceId ? (
          <a
            href={`/api/invoices/${sampleInvoiceId}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-600 transition hover:bg-neutral-100"
          >
            Preview on a real invoice
          </a>
        ) : null}
        {status ? <span className="text-sm text-neutral-500">{status}</span> : null}
        {error ? <span className="text-sm text-overdue">{error}</span> : null}
      </div>
      <p className="mt-2 text-xs text-neutral-400">Save first — the preview reflects what&apos;s saved.</p>
    </main>
  );
}
