"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatInr } from "@/lib/format";

type DaySummary = { dateIso: string; invoiceCount: number; totalAmount: number };
type InvoiceRow = {
  id: string;
  invoiceNumber: string | null;
  dateIso: string;
  party: string;
  totalAmount: number;
  lineItemCount: number;
};
type InvoiceDetail = {
  id: string;
  invoiceNumber: string | null;
  dateIso: string;
  party: string;
  partyPhone: string | null;
  totalAmount: number;
  lineItems: { id: string; itemName: string; quantity: number; unitPrice: number; amount: number }[];
};

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function InvoicesClient() {
  const [days, setDays] = useState<DaySummary[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayInvoices, setDayInvoices] = useState<InvoiceRow[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<InvoiceRow[] | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/invoices/days")
      .then((r) => r.json())
      .then((b) => setDays(b.days ?? []))
      .catch(() => setError("Couldn't load days"))
      .finally(() => setLoading(false));
  }, []);

  const openDay = useCallback(async (dateIso: string) => {
    setSelectedDay(dateIso);
    setDetail(null);
    setSearchResults(null);
    setQuery("");
    setError("");
    try {
      const res = await fetch(`/api/invoices/days?date=${dateIso}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't load that day");
      setDayInvoices(body.invoices);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that day");
    }
  }, []);

  // Debounced search; an empty box returns to the day browser.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/invoices/search?q=${encodeURIComponent(q)}`);
        const body = await res.json();
        setSearchResults(body.invoices ?? []);
        setDetail(null);
      } catch {
        setError("Search failed");
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function openInvoice(id: string) {
    setError("");
    try {
      const res = await fetch(`/api/invoices/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't load invoice");
      setDetail(body.invoice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load invoice");
    }
  }

  const listToShow = searchResults ?? (selectedDay ? dayInvoices : null);
  const listLabel = searchResults
    ? `${searchResults.length} match${searchResults.length === 1 ? "" : "es"}`
    : selectedDay
      ? `${prettyDate(selectedDay)} · ${dayInvoices.length} invoice${dayInvoices.length === 1 ? "" : "s"}`
      : "";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Invoices</h1>
          <p className="text-xs text-neutral-500">Browse by day, or search by party or bill number</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/invoice-design"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
          >
            PDF design
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by party name or bill number…"
        className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      {error ? <p className="mb-3 text-sm text-overdue">{error}</p> : null}
      {loading ? <p className="text-sm text-neutral-500">Loading…</p> : null}

      {detail ? (
        <section className="mb-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-neutral-900">{detail.party}</p>
              <p className="text-xs text-neutral-500">
                {prettyDate(detail.dateIso)}
                {detail.invoiceNumber ? ` · Bill #${detail.invoiceNumber}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <a
                href={`/api/invoices/${detail.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 transition hover:bg-neutral-100"
              >
                PDF
              </a>
              <button onClick={() => setDetail(null)} className="text-xs font-semibold text-neutral-500">
                Close
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="pb-2 font-semibold">Item</th>
                  <th className="pb-2 text-right font-semibold">Qty</th>
                  <th className="pb-2 text-right font-semibold">Rate</th>
                  <th className="pb-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {detail.lineItems.map((li) => (
                  <tr key={li.id}>
                    <td className="py-1.5">{li.itemName}</td>
                    <td className="py-1.5 text-right">{li.quantity}</td>
                    <td className="py-1.5 text-right">₹{formatInr(li.unitPrice)}</td>
                    <td className="py-1.5 text-right font-medium">₹{formatInr(li.amount)}</td>
                  </tr>
                ))}
                {detail.lineItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-neutral-400">
                      No line items recorded for this bill.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-300">
                  <td colSpan={3} className="pt-2 text-right font-semibold text-neutral-600">
                    Total
                  </td>
                  <td className="pt-2 text-right font-bold text-neutral-900">₹{formatInr(detail.totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : null}

      {listToShow ? (
        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{listLabel}</p>
            {!searchResults ? (
              <button onClick={() => setSelectedDay(null)} className="text-xs font-semibold text-brand">
                ← All days
              </button>
            ) : null}
          </div>
          <div className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            {listToShow.map((inv) => (
              <button
                key={inv.id}
                onClick={() => openInvoice(inv.id)}
                className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{inv.party}</p>
                  <p className="text-xs text-neutral-500">
                    {prettyDate(inv.dateIso)}
                    {inv.invoiceNumber ? ` · #${inv.invoiceNumber}` : ""} · {inv.lineItemCount} item
                    {inv.lineItemCount === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-neutral-900">₹{formatInr(inv.totalAmount)}</span>
              </button>
            ))}
            {listToShow.length === 0 ? (
              <p className="p-6 text-center text-sm text-neutral-500">Nothing found.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {!listToShow && !loading ? (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Recent days</p>
          <div className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            {days.map((d) => (
              <button
                key={d.dateIso}
                onClick={() => openDay(d.dateIso)}
                className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-neutral-50"
              >
                <div>
                  <p className="font-medium text-neutral-900">{prettyDate(d.dateIso)}</p>
                  <p className="text-xs text-neutral-500">
                    {d.invoiceCount} invoice{d.invoiceCount === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="font-semibold text-neutral-900">₹{formatInr(d.totalAmount)}</span>
              </button>
            ))}
            {days.length === 0 ? <p className="p-6 text-center text-sm text-neutral-500">No sales yet.</p> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
