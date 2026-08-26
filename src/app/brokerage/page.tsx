"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { formatInr } from "@/lib/format";
import { brokerageApi, ReportSummary } from "@/lib/brokerageApi";

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function BrokerageHomePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await brokerageApi.listReports();
      setReports(r.reports);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const report = await brokerageApi.uploadFile(file);
      router.push(`/brokerage/report/${report.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Delete this report? This also removes its payment history.")) return;
    try {
      await brokerageApi.deleteReport(id);
      setReports((r) => r.filter((x) => x.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold text-neutral-900">Brokerage Reports</h1>
        </div>
        <Link href="/brokerage/analytics" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100">
          Analytics
        </Link>
      </header>

      <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={onFileChosen} />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="mb-6 w-full rounded-xl bg-brand py-3 font-semibold text-white transition disabled:opacity-50"
      >
        {uploading ? "Uploading…" : "Upload New Sale Report (.xlsx)"}
      </button>

      {error ? <p className="mb-4 rounded-lg bg-overdue/10 px-3 py-2 text-sm text-overdue">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No reports yet. Upload a raw sale Excel and we&apos;ll split it broker-wise.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/brokerage/report/${r.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-neutral-900">{r.filename}</p>
                  <p className="text-xs text-neutral-500">
                    {fmtDateTime(r.uploadedAt)} · {fmtSize(r.fileSize)}
                  </p>
                </Link>
                <button onClick={() => onDelete(r.id)} className="shrink-0 text-xs font-medium text-overdue hover:underline">
                  Delete
                </button>
              </div>
              <div className="mt-3 flex items-center gap-6 border-t border-neutral-100 pt-3 text-sm">
                <div>
                  <p className="text-xs text-neutral-400">Txns</p>
                  <p className="font-semibold">{r.summary.totalTransactions}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-400">Amount</p>
                  <p className="font-semibold">₹{formatInr(r.summary.totalAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-400">Brokerage</p>
                  <p className="font-semibold text-brand">₹{formatInr(r.summary.totalBrokerage)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
