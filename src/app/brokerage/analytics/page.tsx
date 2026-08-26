"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { formatInr } from "@/lib/format";
import { brokerageApi, InactiveParty, MonthlyComparison, TopParty } from "@/lib/brokerageApi";

type Tab = "monthly" | "top" | "inactive";

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idx = parseInt(m ?? "1", 10) - 1;
  return `${names[idx] ?? m} ${y}`;
}

export default function BrokerageAnalyticsPage() {
  const [tab, setTab] = useState<Tab>("monthly");
  const [monthly, setMonthly] = useState<MonthlyComparison | null>(null);
  const [topParties, setTopParties] = useState<TopParty[] | null>(null);
  const [inactive, setInactive] = useState<{
    currentMonth: string | null;
    prevMonth: string | null;
    parties: InactiveParty[];
    note?: string;
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    brokerageApi.monthlyComparison().then(setMonthly).catch((e) => setError(e.message));
    brokerageApi
      .topParties(undefined, 30)
      .then((r) => setTopParties(r.parties))
      .catch((e) => setError(e.message));
    brokerageApi.inactiveParties().then(setInactive).catch((e) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/brokerage" className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
        ← Reports
      </Link>
      <h1 className="mt-1 text-xl font-bold text-neutral-900">Analytics</h1>

      <div className="mt-4 flex gap-2 border-b border-neutral-200">
        {(["monthly", "top", "inactive"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${tab === t ? "border-b-2 border-brand text-brand" : "text-neutral-500"}`}
          >
            {t === "monthly" ? "Monthly" : t === "top" ? "Top Parties" : "Inactive"}
          </button>
        ))}
      </div>

      {error ? <p className="mt-4 text-sm text-overdue">{error}</p> : null}

      {tab === "monthly" ? (
        !monthly ? (
          <p className="mt-4 text-sm text-neutral-500">Loading…</p>
        ) : monthly.months.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">No reports uploaded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                  <th className="px-3 py-2">Broker</th>
                  {monthly.months.map((m) => (
                    <th key={m} className="px-3 py-2 text-right">
                      {fmtMonth(m)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {monthly.brokers.map((b) => (
                  <tr key={b.name} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2 font-medium">{b.name}</td>
                    {monthly.months.map((m) => (
                      <td key={m} className="px-3 py-2 text-right text-neutral-600">
                        ₹{formatInr(b.monthly[m]?.amount ?? 0)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold text-brand">₹{formatInr(b.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "top" ? (
        !topParties ? (
          <p className="mt-4 text-sm text-neutral-500">Loading…</p>
        ) : topParties.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">No purchase data yet.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {topParties.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-neutral-400">#{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{p.name}</p>
                    <p className="text-xs text-neutral-500">{p.txns} purchases</p>
                  </div>
                </div>
                <span className="font-semibold text-brand">₹{formatInr(p.amount)}</span>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === "inactive" ? (
        !inactive ? (
          <p className="mt-4 text-sm text-neutral-500">Loading…</p>
        ) : inactive.note ? (
          <p className="mt-4 text-sm text-neutral-500">{inactive.note}</p>
        ) : inactive.parties.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">No drop-offs detected between {inactive.prevMonth} and {inactive.currentMonth}.</p>
        ) : (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-neutral-500">
              Comparing {inactive.prevMonth ? fmtMonth(inactive.prevMonth) : ""} → {inactive.currentMonth ? fmtMonth(inactive.currentMonth) : ""}
            </p>
            {inactive.parties.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{p.name}</p>
                  <p className="text-xs text-neutral-500">
                    ₹{formatInr(p.previousAmount)} → ₹{formatInr(p.currentAmount)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    p.status === "missing" ? "bg-overdue/10 text-overdue" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {p.status === "missing" ? "MISSING" : `-${p.dropPct}%`}
                </span>
              </div>
            ))}
          </div>
        )
      ) : null}
    </main>
  );
}
