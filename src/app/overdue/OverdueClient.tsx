"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { formatInr } from "@/lib/format";

type OverdueInvoice = {
  invoiceId: string;
  date: string;
  dueDate: string;
  invoiceNumber: string | null;
  isOpeningBalance: boolean;
  amount: number;
  unpaid: number;
  daysOverdue: number;
  daysSince: number;
  isOverdue: boolean;
};

type OverdueCustomer = {
  customerId: string;
  party: string;
  phone: string | null;
  balance: number;
  overdueAmount: number;
  upcomingAmount: number;
  maxDaysOverdue: number;
  maxDaysSince: number;
  invoiceCount: number;
  creditDays: number;
  creditDaysCustom: boolean;
  invoices: OverdueInvoice[];
  reminderMessage: string;
  whatsappLink: string | null;
};

type OverdueResponse = {
  creditDays: number;
  summary: { customerCount: number; totalOverdue: number; totalOutstanding: number };
  customers: OverdueCustomer[];
};

// "Turant" = immediately (no grace period at all).
const CREDIT_DAY_CHIPS = [
  { label: "Default", value: null },
  { label: "Turant", value: 0 },
  { label: "7 din", value: 7 },
  { label: "15 din", value: 15 },
  { label: "21 din", value: 21 },
  { label: "30 din", value: 30 },
];

type SortKey = "days" | "amount";

export function OverdueClient() {
  const [data, setData] = useState<OverdueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creditDays, setCreditDays] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("days");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [phoneEdits, setPhoneEdits] = useState<Record<string, string>>({});
  const [savingPhone, setSavingPhone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const qs = creditDays === null ? "" : `?creditDays=${creditDays}`;
    fetch(`/api/overdue${qs}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Couldn't load overdue accounts");
        return body as OverdueResponse;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load overdue accounts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [creditDays]);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const filtered = q ? data.customers.filter((c) => c.party.toLowerCase().includes(q)) : data.customers;
    return [...filtered].sort((a, b) =>
      sortKey === "amount"
        ? b.overdueAmount - a.overdueAmount
        : b.maxDaysOverdue - a.maxDaysOverdue || b.overdueAmount - a.overdueAmount,
    );
  }, [data, query, sortKey]);

  async function savePhone(customerId: string) {
    const phone = (phoneEdits[customerId] ?? "").trim();
    if (!phone) return;
    setSavingPhone(customerId);
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't save");
      // Re-fetch so the WhatsApp link is rebuilt server-side with the new number.
      const qs = creditDays === null ? "" : `?creditDays=${creditDays}`;
      const fresh = await fetch(`/api/overdue${qs}`).then((r) => r.json());
      setData(fresh);
      setPhoneEdits((p) => ({ ...p, [customerId]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the number");
    } finally {
      setSavingPhone(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Overdue Accounts</h1>
          <p className="text-xs text-neutral-500">Who owes you money, oldest bills first</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/settings/overdue"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
          >
            Settings
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
          >
            Dashboard
          </Link>
        </div>
      </header>

      {data ? (
        <section className="mb-6 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Customers</p>
            <p className="mt-1 text-xl font-bold text-neutral-900">{data.summary.customerCount}</p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Total Overdue</p>
            <p className="mt-1 text-xl font-bold text-overdue">₹{formatInr(data.summary.totalOverdue)}</p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Total Baki</p>
            <p className="mt-1 text-xl font-bold text-neutral-900">₹{formatInr(data.summary.totalOutstanding)}</p>
          </div>
        </section>
      ) : null}

      <section className="mb-4 space-y-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Credit period</p>
          <div className="flex flex-wrap gap-2">
            {CREDIT_DAY_CHIPS.map((chip) => {
              const active = creditDays === chip.value;
              return (
                <button
                  key={chip.label}
                  onClick={() => setCreditDays(chip.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "border-brand bg-brand text-white"
                      : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-neutral-400">
            {creditDays === null
              ? "Using each customer's own credit period, falling back to your default."
              : `Overriding every customer with ${creditDays} din for this view only.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer…"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex gap-1">
            <button
              onClick={() => setSortKey("days")}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                sortKey === "days" ? "border-brand text-brand" : "border-neutral-300 text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              By days
            </button>
            <button
              onClick={() => setSortKey("amount")}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                sortKey === "amount" ? "border-brand text-brand" : "border-neutral-300 text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              By amount
            </button>
          </div>
        </div>
      </section>

      {error ? <p className="mb-4 text-sm text-overdue">{error}</p> : null}
      {loading ? <p className="text-sm text-neutral-500">Loading…</p> : null}

      {!loading && visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          {query ? "No customer matches that search." : "No overdue accounts. Nice work! 🎉"}
        </div>
      ) : null}

      <div className="space-y-3">
        {visible.map((c) => {
          const isOpen = expanded === c.customerId;
          return (
            <div key={c.customerId} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <button
                onClick={() => setExpanded(isOpen ? null : c.customerId)}
                className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-neutral-900">{c.party}</p>
                  <p className="text-xs text-neutral-500">
                    {c.invoiceCount} bill{c.invoiceCount === 1 ? "" : "s"} · {c.maxDaysOverdue} din overdue ·{" "}
                    {c.creditDays} din credit{c.creditDaysCustom ? " (custom)" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold text-overdue">₹{formatInr(c.overdueAmount)}</p>
                  {c.upcomingAmount > 0 ? (
                    <p className="text-xs text-neutral-400">+₹{formatInr(c.upcomingAmount)} not due yet</p>
                  ) : null}
                </div>
              </button>

              {isOpen ? (
                <div className="border-t border-neutral-200 bg-neutral-50 p-4">
                  <div className="mb-3 overflow-x-auto">
                    <table className="w-full min-w-[480px] text-left text-xs">
                      <thead className="text-neutral-500">
                        <tr>
                          <th className="pb-2 font-semibold">Bill date</th>
                          <th className="pb-2 font-semibold">Due date</th>
                          <th className="pb-2 text-right font-semibold">Bill amount</th>
                          <th className="pb-2 text-right font-semibold">Pending</th>
                          <th className="pb-2 text-right font-semibold">Overdue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-200">
                        {c.invoices.map((inv) => (
                          <tr key={inv.invoiceId} className={inv.isOverdue ? "" : "text-neutral-400"}>
                            <td className="py-1.5">
                              {inv.isOpeningBalance ? (
                                <span title="Carried over from before this backup's history">
                                  Purana baki{" "}
                                  <span className="text-neutral-400">({inv.date})</span>
                                </span>
                              ) : (
                                inv.date
                              )}
                            </td>
                            <td className="py-1.5">{inv.dueDate}</td>
                            <td className="py-1.5 text-right">₹{formatInr(inv.amount)}</td>
                            <td className="py-1.5 text-right font-medium">₹{formatInr(inv.unpaid)}</td>
                            <td className="py-1.5 text-right">
                              {inv.isOverdue ? `${inv.daysOverdue}d` : "not due"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <details className="mb-3">
                    <summary className="cursor-pointer text-xs font-semibold text-neutral-600">
                      Preview reminder message
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-3 text-xs text-neutral-700">
                      {c.reminderMessage}
                    </pre>
                  </details>

                  {c.whatsappLink ? (
                    <a
                      href={c.whatsappLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded-lg bg-[#25D366] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90"
                    >
                      Send WhatsApp reminder
                    </a>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={phoneEdits[c.customerId] ?? ""}
                        onChange={(e) => setPhoneEdits((p) => ({ ...p, [c.customerId]: e.target.value }))}
                        placeholder="Add phone number"
                        inputMode="tel"
                        className="w-48 rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                      <button
                        onClick={() => savePhone(c.customerId)}
                        disabled={savingPhone === c.customerId || !(phoneEdits[c.customerId] ?? "").trim()}
                        className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-50"
                      >
                        {savingPhone === c.customerId ? "Saving…" : "Save & enable WhatsApp"}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
