"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatInr } from "@/lib/format";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  creditDays: number | null;
  balance: number;
};

type Draft = { phone: string; note: string; creditDays: string };

function toDraft(c: Customer): Draft {
  return {
    phone: c.phone ?? "",
    note: c.note ?? "",
    creditDays: c.creditDays === null ? "" : String(c.creditDays),
  };
}

export function CustomersClient({ defaultCreditDays }: { defaultCreditDays: number }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [missingPhoneOnly, setMissingPhoneOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ phone: "", note: "", creditDays: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (missingPhoneOnly) params.set("missingPhone", "1");
      const res = await fetch(`/api/customers?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't load customers");
      setCustomers(body.customers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load customers");
    } finally {
      setLoading(false);
    }
  }, [query, missingPhoneOnly]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce while typing in search
    return () => clearTimeout(t);
  }, [load]);

  function startEdit(c: Customer) {
    setEditing(c.id);
    setDraft(toDraft(c));
    setError("");
  }

  async function save(id: string) {
    setSaving(true);
    setError("");
    try {
      let creditDays: number | null = null;
      if (draft.creditDays.trim()) {
        const n = Number(draft.creditDays);
        if (!Number.isInteger(n) || n < 0 || n > 365) {
          throw new Error("Credit days must be a whole number between 0 and 365, or blank to use the default");
        }
        creditDays = n;
      }
      const res = await fetch(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: draft.phone, note: draft.note, creditDays }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't save");
      setCustomers((list) => list.map((c) => (c.id === id ? body.customer : c)));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const missingCount = customers.filter((c) => !c.phone).length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Customers</h1>
          <p className="text-xs text-neutral-500">Phone numbers, notes and per-customer credit terms</p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
        >
          Dashboard
        </Link>
      </header>

      <p className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
        Customers come from Vyapar automatically — names and balances update on every sync. Phone numbers, notes and
        credit days are yours to edit here and are never overwritten by a sync.
      </p>

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customer…"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button
          onClick={() => setMissingPhoneOnly((v) => !v)}
          className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
            missingPhoneOnly ? "border-brand bg-brand text-white" : "border-neutral-300 text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          No phone only
        </button>
      </section>

      {error ? <p className="mb-3 text-sm text-overdue">{error}</p> : null}
      {loading ? <p className="text-sm text-neutral-500">Loading…</p> : null}

      {!loading && customers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No customers match.
        </div>
      ) : null}

      {!loading && customers.length > 0 ? (
        <p className="mb-3 text-xs text-neutral-500">
          {customers.length} shown{missingCount > 0 ? ` · ${missingCount} without a phone number` : ""}
        </p>
      ) : null}

      <div className="space-y-2">
        {customers.map((c) => {
          const isEditing = editing === c.id;
          return (
            <div key={c.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-neutral-900">{c.name}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {c.phone ? c.phone : <span className="text-overdue">No phone number</span>}
                    {" · "}
                    {c.creditDays === null ? `${defaultCreditDays} din (default)` : `${c.creditDays} din credit`}
                  </p>
                  {c.note ? <p className="mt-1 text-xs text-neutral-400">{c.note}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-bold ${c.balance > 0 ? "text-overdue" : "text-neutral-400"}`}>
                    ₹{formatInr(c.balance)}
                  </p>
                  {!isEditing ? (
                    <button onClick={() => startEdit(c)} className="mt-1 text-xs font-semibold text-brand">
                      Edit
                    </button>
                  ) : null}
                </div>
              </div>

              {isEditing ? (
                <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-semibold text-neutral-600">Phone</span>
                      <input
                        value={draft.phone}
                        onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                        inputMode="tel"
                        placeholder="10-digit mobile"
                        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-neutral-600">
                        Credit days <span className="font-normal text-neutral-400">(blank = default)</span>
                      </span>
                      <input
                        value={draft.creditDays}
                        onChange={(e) => setDraft((d) => ({ ...d, creditDays: e.target.value }))}
                        inputMode="numeric"
                        placeholder={String(defaultCreditDays)}
                        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-xs font-semibold text-neutral-600">Note</span>
                    <input
                      value={draft.note}
                      onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                      placeholder="Anything worth remembering about this party"
                      className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                  </label>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => save(c.id)}
                      disabled={saving}
                      className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-600 transition hover:bg-neutral-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
