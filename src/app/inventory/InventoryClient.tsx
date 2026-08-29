"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatInr } from "@/lib/format";

type SoldRow = {
  itemName: string;
  quantity: number;
  revenue: number;
  saleCount: number;
  averageRate: number;
  listRate: number | null;
};

type ItemRow = {
  id: string;
  name: string;
  salePrice: number | null;
  purchasePrice: number | null;
};

type Tab = "sold" | "items";

export function InventoryClient() {
  const [tab, setTab] = useState<Tab>("sold");
  const [days, setDays] = useState(30);
  const [sold, setSold] = useState<{ items: SoldRow[]; totals: { revenue: number; itemCount: number; lineCount: number } } | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [summary, setSummary] = useState<{ itemCount: number; withPurchaseRate: number } | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tab !== "sold") return;
    setLoading(true);
    fetch(`/api/inventory?days=${days}`)
      .then((r) => r.json())
      .then(setSold)
      .finally(() => setLoading(false));
  }, [tab, days]);

  useEffect(() => {
    if (tab !== "items") return;
    setLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ view: "items" });
      if (query.trim()) params.set("q", query.trim());
      fetch(`/api/inventory?${params}`)
        .then((r) => r.json())
        .then((b) => {
          setItems(b.items ?? []);
          setSummary(b.summary ?? null);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [tab, query]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Items</h1>
          <p className="text-xs text-neutral-500">What&apos;s selling, and at what rate</p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
        >
          Dashboard
        </Link>
      </header>

      <div className="mb-4 flex gap-2">
        {(
          [
            ["sold", "What sold"],
            ["items", "Item list"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              tab === t ? "border-brand bg-brand text-white" : "border-neutral-300 text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "sold" ? (
        <>
          <div className="mb-3 flex gap-2">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                  days === d ? "border-brand text-brand" : "border-neutral-300 text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                Last {d} din
              </button>
            ))}
          </div>

          {sold ? (
            <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Revenue</p>
                <p className="mt-1 text-xl font-bold text-neutral-900">₹{formatInr(sold.totals.revenue)}</p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Items sold</p>
                <p className="mt-1 text-xl font-bold text-neutral-900">{sold.totals.itemCount}</p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Sale lines</p>
                <p className="mt-1 text-xl font-bold text-neutral-900">{sold.totals.lineCount}</p>
              </div>
            </section>
          ) : null}

          {loading ? <p className="text-sm text-neutral-500">Loading…</p> : null}

          <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-neutral-200 text-xs text-neutral-500">
                <tr>
                  <th className="p-3 font-semibold">Item</th>
                  <th className="p-3 text-right font-semibold">Qty</th>
                  <th className="p-3 text-right font-semibold">Revenue</th>
                  <th className="p-3 text-right font-semibold">Avg rate</th>
                  <th className="p-3 text-right font-semibold">List rate</th>
                  <th className="p-3 text-right font-semibold">Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {sold?.items.map((s) => {
                  // Selling consistently under the list rate is worth seeing.
                  const under = s.listRate !== null && s.listRate > 0 && s.averageRate < s.listRate * 0.97;
                  return (
                    <tr key={s.itemName}>
                      <td className="p-3 font-medium text-neutral-900">{s.itemName}</td>
                      <td className="p-3 text-right">{s.quantity}</td>
                      <td className="p-3 text-right font-medium">₹{formatInr(s.revenue)}</td>
                      <td className={`p-3 text-right ${under ? "text-amber-700" : ""}`}>₹{formatInr(s.averageRate)}</td>
                      <td className="p-3 text-right text-neutral-400">
                        {s.listRate !== null ? `₹${formatInr(s.listRate)}` : "—"}
                      </td>
                      <td className="p-3 text-right text-neutral-500">{s.saleCount}</td>
                    </tr>
                  );
                })}
                {!loading && sold && sold.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-neutral-500">
                      Nothing sold in this period.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search item…"
            className="mb-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />

          {summary ? (
            <p className="mb-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
              {summary.itemCount} items · {summary.withPurchaseRate} have a buying rate recorded.{" "}
              {summary.withPurchaseRate < summary.itemCount * 0.5 ? (
                <>
                  Profit margins aren&apos;t shown because most items have no buying rate in Vyapar — costing only
                  a fraction of what you sell would give a confidently wrong number. Fill in purchase rates in
                  Vyapar and margins become possible.
                </>
              ) : null}
            </p>
          ) : null}

          {loading ? <p className="text-sm text-neutral-500">Loading…</p> : null}

          <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="border-b border-neutral-200 text-xs text-neutral-500">
                <tr>
                  <th className="p-3 font-semibold">Item</th>
                  <th className="p-3 text-right font-semibold">Sale rate</th>
                  <th className="p-3 text-right font-semibold">Buy rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="p-3 font-medium text-neutral-900">{i.name}</td>
                    <td className="p-3 text-right">{i.salePrice !== null ? `₹${formatInr(i.salePrice)}` : "—"}</td>
                    <td className="p-3 text-right text-neutral-500">
                      {i.purchasePrice !== null && i.purchasePrice > 0 ? `₹${formatInr(i.purchasePrice)}` : "—"}
                    </td>
                  </tr>
                ))}
                {!loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-neutral-500">
                      No items match.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
