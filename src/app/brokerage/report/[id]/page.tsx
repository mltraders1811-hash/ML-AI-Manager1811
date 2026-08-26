"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

import { formatInr } from "@/lib/format";
import { brokerageApi, ReportDetail } from "@/lib/brokerageApi";

export default function BrokerageReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    brokerageApi
      .getReport(id)
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load report"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <main className="p-8 text-sm text-neutral-500">Loading…</main>;
  if (error || !report) return <main className="p-8 text-sm text-overdue">{error || "Not found"}</main>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/brokerage" className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
        ← Reports
      </Link>
      <h1 className="mt-1 truncate text-xl font-bold text-neutral-900">{report.filename}</h1>

      <div className="mt-4 rounded-2xl bg-brand-dark p-6 text-white">
        <p className="text-xs uppercase tracking-wide text-white/70">Total sales analyzed</p>
        <p className="mt-1 text-3xl font-bold">₹{formatInr(report.summary.totalAmount)}</p>
        <div className="mt-4 flex gap-8 border-t border-white/15 pt-4">
          <div>
            <p className="text-xs text-white/60">Transactions</p>
            <p className="text-lg font-semibold">{report.summary.totalTransactions}</p>
          </div>
          <div>
            <p className="text-xs text-white/60">Brokerage (0.5%)</p>
            <p className="text-lg font-semibold text-amber-300">₹{formatInr(report.summary.totalBrokerage)}</p>
          </div>
        </div>
      </div>

      <Link
        href={`/brokerage/payments/${report.id}`}
        className="mt-4 flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:bg-neutral-50"
      >
        <div>
          <p className="font-semibold text-neutral-900">Brokerage Payments</p>
          <p className="text-xs text-neutral-500">Track which broker is paid &amp; pending</p>
        </div>
        <span className="text-neutral-400">→</span>
      </Link>

      <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Brokers ({report.brokers.length})
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {report.brokers.map((b) => (
          <Link
            key={b.name}
            href={`/brokerage/report/${report.id}/broker/${encodeURIComponent(b.name)}`}
            className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:bg-neutral-50"
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold text-neutral-900">{b.name}</p>
              {b.isShopOwn ? (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">No brokerage</span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-neutral-500">{b.transactionCount} txns</p>
            <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2 text-sm">
              <span className="text-neutral-600">₹{formatInr(b.totalAmount)}</span>
              <span className="font-semibold text-brand">₹{formatInr(b.totalBrokerage)}</span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
