import Link from "next/link";

import { ActionCenterList } from "@/components/ActionCenterList";
import { LogoutButton } from "@/components/LogoutButton";
import { MetricCard } from "@/components/MetricCard";
import { getEnv } from "@/lib/env";
import { formatInr } from "@/lib/format";
import { getLastSyncRun, getOverdueCustomers, getQuickMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic"; // always show fresh dues, never cache

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function DashboardPage() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const [metrics, overdueCustomers, lastSync] = await Promise.all([
    getQuickMetrics(DEFAULT_COMPANY_ID),
    getOverdueCustomers(DEFAULT_COMPANY_ID),
    getLastSyncRun(DEFAULT_COMPANY_ID),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">M.L AI Manager</h1>
          <p className="text-xs text-neutral-500">
            {lastSync
              ? `Last synced ${timeAgo(lastSync.startedAt)}${lastSync.status === "FAILED" ? " · last sync FAILED" : ""}`
              : "No sync has run yet"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/brokerage" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100">
            Brokerage
          </Link>
          <Link href="/chat" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100">
            AI Chat
          </Link>
          <LogoutButton />
        </div>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Total Outstanding" value={`₹${formatInr(metrics.totalOutstanding)}`} tone="brand" />
        <MetricCard
          label="Overdue"
          value={`₹${formatInr(metrics.overdueAmount)}`}
          sub={`${metrics.overdueCount} invoice${metrics.overdueCount === 1 ? "" : "s"}`}
          tone="overdue"
        />
        <MetricCard label="Yesterday's Sales" value={`₹${formatInr(metrics.yesterdaySales)}`} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Action Center</h2>
        <ActionCenterList customers={overdueCustomers} />
      </section>
    </main>
  );
}
