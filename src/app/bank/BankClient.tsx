"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatInr } from "@/lib/format";

type Suggestion = { customerId: string; name: string; confidence: number; reasons: string[] };

type BankTxn = {
  id: string;
  date: string;
  description: string;
  counterparty: string | null;
  reference: string | null;
  direction: "CREDIT" | "DEBIT";
  amount: number;
  status: "UNMATCHED" | "SUGGESTED" | "MATCHED" | "IGNORED";
  customer: { id: string; name: string; balance: number } | null;
  matchedBy: "AUTO_RULE" | "AUTO_NAME" | "MANUAL" | null;
  matchConfidence: number | null;
  note: string | null;
  ignoreReason: string | null;
  accountLabel: string;
  suggestions: Suggestion[];
  similarPending: number;
};

type Summary = {
  needsReview: { count: number; amount: number };
  thisMonth: { received: number; paidOut: number; assigned: number; unassigned: number };
  autoMatchedThisMonth: number;
  lastImport: { at: string; filename: string; source: "UPLOAD" | "DRIVE" | "API"; rowsImported: number } | null;
  accounts: { id: string; label: string; lastTxnDate: string | null; balance: number | null }[];
  alerts: { booked: number; duplicate: number; ignored: number; lastAt: string | null };
  hasData: boolean;
  receiptsThisMonth: { customerId: string; name: string; received: number; count: number }[];
};

type CustomerOption = { id: string; name: string; phone: string | null; balance: number };

type View = "review" | "assigned" | "ignored" | "out" | "all";

const TABS: { key: View; label: string }[] = [
  { key: "review", label: "Kiska hai?" },
  { key: "assigned", label: "Assigned" },
  { key: "out", label: "Paid out" },
  { key: "ignored", label: "Not payments" },
  { key: "all", label: "All" },
];

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${d.toLocaleString("en-IN", { month: "short", timeZone: "UTC" })}`;
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function matchExplanation(txn: BankTxn): string {
  if (txn.matchedBy === "MANUAL") return "You assigned this";
  if (txn.matchedBy === "AUTO_RULE") return "Matched automatically - same payer as before";
  if (txn.matchedBy === "AUTO_NAME") return "Matched automatically - the narration named them";
  return "";
}

/** The one screen this feature exists for: whose payment is this? */
export function BankClient() {
  const [view, setView] = useState<View>("review");
  const [query, setQuery] = useState("");
  const [transactions, setTransactions] = useState<BankTxn[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState("");
  const [picking, setPicking] = useState<BankTxn | null>(null);
  const [applySimilar, setApplySimilar] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ view });
      if (query.trim()) params.set("q", query.trim());
      const [txnRes, sumRes] = await Promise.all([
        fetch(`/api/bank/transactions?${params.toString()}`),
        fetch("/api/bank/summary"),
      ]);
      const txnBody = await txnRes.json();
      const sumBody = await sumRes.json();
      if (!txnRes.ok) throw new Error(txnBody.error ?? "Couldn't load the bank entries");
      if (!sumRes.ok) throw new Error(sumBody.error ?? "Couldn't load the bank summary");
      setTransactions(txnBody.transactions ?? []);
      setSummary(sumBody);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the bank entries");
    } finally {
      setLoading(false);
    }
  }, [view, query]);

  useEffect(() => {
    // Debounced so typing in the search box doesn't fire a request per key.
    const t = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  async function act(txn: BankTxn, body: Record<string, unknown>, message: (res: { alsoApplied?: number }) => string) {
    setBusyId(txn.id);
    setError("");
    try {
      const res = await fetch(`/api/bank/transactions/${txn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "That didn't save");
      setFlash(message(result));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save");
    } finally {
      setBusyId(null);
    }
  }

  function assign(txn: BankTxn, customerId: string, name: string) {
    setPicking(null);
    const alsoAsked = applySimilar && txn.similarPending > 0;
    return act(txn, { action: "assign", customerId, applySimilar: alsoAsked }, (res) =>
      res.alsoApplied
        ? `Saved to ${name}, and ${res.alsoApplied} more entr${res.alsoApplied === 1 ? "y" : "ies"} from the same payer`
        : `Saved to ${name}`,
    );
  }

  async function upload(file: File) {
    setUploading(true);
    setError("");
    setUploadNote("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/bank/statements/upload", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't read that statement");
      setUploadNote(
        `${body.accountLabel}: ${body.rowsImported} new entr${body.rowsImported === 1 ? "y" : "ies"}` +
          (body.rowsDuplicate ? `, ${body.rowsDuplicate} already had` : "") +
          (body.autoMatched ? `, ${body.autoMatched} matched automatically` : "") +
          (body.needsReview ? `, ${body.needsReview} need naming` : ""),
      );
      setView("review");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that statement");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const reviewCount = summary?.needsReview.count ?? 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pb-24">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Bank</h1>
          <p className="text-xs text-neutral-500">
            {summary?.lastImport
              ? `Statement read ${timeAgo(summary.lastImport.at)} · ${
                  summary.lastImport.source === "DRIVE" ? "picked up automatically" : "uploaded"
                }`
              : "No statement read yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,.xlsm,.txt,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {uploading ? "Reading…" : "Add statement"}
          </button>
          <Link
            href="/"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
          >
            Home
          </Link>
        </div>
      </header>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}
      {uploadNote ? (
        <p className="mb-4 rounded-xl border border-brand/30 bg-brand-light px-4 py-3 text-sm text-brand-dark">{uploadNote}</p>
      ) : null}
      {flash ? (
        <p className="mb-4 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">{flash}</p>
      ) : null}

      {summary && !summary.hasData ? <GettingStarted onPick={() => fileInput.current?.click()} /> : null}

      {summary?.alerts.lastAt ? (
        <p className="mb-4 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-xs text-neutral-600">
          Bank SMS forwarding is live · last message {timeAgo(summary.alerts.lastAt)}
          {summary.alerts.booked ? ` · ${summary.alerts.booked} booked` : ""}
          {summary.alerts.duplicate ? ` · ${summary.alerts.duplicate} already had` : ""}
          {summary.alerts.ignored ? ` · ${summary.alerts.ignored} skipped` : ""} (7 din)
        </p>
      ) : null}

      {summary?.hasData ? (
        <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label="Needs naming"
            value={String(summary.needsReview.count)}
            sub={`₹${formatInr(summary.needsReview.amount)}`}
            tone={summary.needsReview.count > 0 ? "alert" : "muted"}
          />
          <Tile label="Received this month" value={`₹${formatInr(summary.thisMonth.received)}`} tone="brand" />
          <Tile label="Still unnamed" value={`₹${formatInr(summary.thisMonth.unassigned)}`} sub="of this month" />
          <Tile
            label="Matched for you"
            value={String(summary.autoMatchedThisMonth)}
            sub="this month, automatically"
            tone="muted"
          />
        </section>
      ) : null}

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setView(tab.key)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition ${
              view === tab.key ? "bg-brand text-white" : "border border-neutral-300 bg-white text-neutral-600"
            }`}
          >
            {tab.label}
            {tab.key === "review" && reviewCount > 0 ? ` (${reviewCount})` : ""}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search narration or customer"
        className="mb-4 w-full rounded-xl border border-neutral-300 px-4 py-2.5 text-sm outline-none focus:border-brand"
      />

      {loading ? (
        <p className="py-8 text-center text-sm text-neutral-500">Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-10 text-center text-sm text-neutral-500">
          {view === "review"
            ? summary?.hasData
              ? "Nothing waiting - every payment has a name against it."
              : "Add a statement to get started."
            : "Nothing here."}
        </p>
      ) : (
        <ul className="space-y-3">
          {transactions.map((txn) => (
            <TxnCard
              key={txn.id}
              txn={txn}
              busy={busyId === txn.id}
              applySimilar={applySimilar}
              onToggleApplySimilar={setApplySimilar}
              onAssign={(customerId, name) => void assign(txn, customerId, name)}
              onPick={() => setPicking(txn)}
              onIgnore={() => void act(txn, { action: "ignore" }, () => "Marked as not a customer payment")}
              onUndo={() => void act(txn, { action: "unassign" }, () => "Back in the review list")}
            />
          ))}
        </ul>
      )}

      {picking ? (
        <CustomerPicker
          txn={picking}
          onClose={() => setPicking(null)}
          onChoose={(customerId, name) => void assign(picking, customerId, name)}
        />
      ) : null}
    </main>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "brand" | "alert" | "muted";
}) {
  const valueClass =
    tone === "alert" ? "text-overdue" : tone === "brand" ? "text-brand" : tone === "muted" ? "text-neutral-500" : "text-neutral-900";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${valueClass}`}>{value}</p>
      {sub ? <p className="text-[11px] text-neutral-400">{sub}</p> : null}
    </div>
  );
}

function GettingStarted({ onPick }: { onPick: () => void }) {
  return (
    <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-neutral-900">Bank ko jodein</h2>
      <ol className="mt-3 space-y-2 text-sm text-neutral-600">
        <li>
          <span className="font-semibold text-neutral-800">1.</span> Net banking se statement download karein - CSV ya
          Excel (PDF nahi).
        </li>
        <li>
          <span className="font-semibold text-neutral-800">2.</span> Yahan{" "}
          <button type="button" onClick={onPick} className="font-semibold text-brand underline">
            Add statement
          </button>{" "}
          dabakar file chunein. Har credit alag dikhega.
        </li>
        <li>
          <span className="font-semibold text-neutral-800">3.</span> Har payment par customer chunein. Agli baar wahi
          payer apne aap pehchan liya jayega.
        </li>
      </ol>
      <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
        <p>
          <span className="font-semibold text-neutral-700">Apne aap, turant:</span> phone par bank ke SMS ko ek
          forwarding app se <code className="rounded bg-neutral-100 px-1">/api/bank/ingest</code> par bhijwayein
          (token <code className="rounded bg-neutral-100 px-1">BANK_INGEST_TOKEN</code>). Payment aate hi yahan dikh
          jayega - statement ka intezaar nahi. Sirf apne bank aur account ke message chunne ke liye{" "}
          <code className="rounded bg-neutral-100 px-1">BANK_ALERT_BANKS</code> aur{" "}
          <code className="rounded bg-neutral-100 px-1">BANK_ALERT_ACCOUNTS</code> set karein.
        </p>
        <p>
          <span className="font-semibold text-neutral-700">Apne aap, roz:</span> bank ka scheduled statement ek Google
          Drive folder me girwayein aur us folder ki ID{" "}
          <code className="rounded bg-neutral-100 px-1">GDRIVE_BANK_STATEMENT_FOLDER_ID</code> me daal dein - roz ki
          sync khud utha legi.
        </p>
      </div>
    </section>
  );
}

function TxnCard({
  txn,
  busy,
  applySimilar,
  onToggleApplySimilar,
  onAssign,
  onPick,
  onIgnore,
  onUndo,
}: {
  txn: BankTxn;
  busy: boolean;
  applySimilar: boolean;
  onToggleApplySimilar: (value: boolean) => void;
  onAssign: (customerId: string, name: string) => void;
  onPick: () => void;
  onIgnore: () => void;
  onUndo: () => void;
}) {
  const [showFull, setShowFull] = useState(false);
  const credit = txn.direction === "CREDIT";
  const needsDecision = txn.status === "UNMATCHED" || txn.status === "SUGGESTED";

  return (
    <li className={`rounded-2xl border bg-white p-4 shadow-sm ${needsDecision && credit ? "border-amber-300" : "border-neutral-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-neutral-900">{txn.counterparty ?? "Unknown payer"}</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {shortDate(txn.date)} · {txn.accountLabel}
          </p>
        </div>
        <p className={`shrink-0 text-lg font-bold ${credit ? "text-brand" : "text-neutral-700"}`}>
          {credit ? "+" : "−"}₹{formatInr(txn.amount)}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setShowFull((v) => !v)}
        className={`mt-2 w-full text-left text-xs text-neutral-500 ${showFull ? "" : "truncate"}`}
      >
        {txn.description}
      </button>

      {txn.customer ? (
        <div className="mt-3 rounded-xl bg-brand-light px-3 py-2">
          <p className="text-sm font-semibold text-brand-dark">{txn.customer.name}</p>
          <p className="text-[11px] text-brand-dark/70">
            {matchExplanation(txn)}
            {txn.customer.balance > 0 ? ` · abhi bhi ₹${formatInr(txn.customer.balance)} baaki` : ""}
          </p>
        </div>
      ) : null}

      {txn.status === "IGNORED" ? (
        <p className="mt-3 text-xs text-neutral-500">Not a customer payment{txn.ignoreReason ? ` · ${txn.ignoreReason}` : ""}</p>
      ) : null}

      {needsDecision ? (
        <div className="mt-3 space-y-2">
          {txn.suggestions.length > 0 ? (
            <div className="space-y-1.5">
              {txn.suggestions.map((s) => (
                <button
                  key={s.customerId}
                  type="button"
                  disabled={busy}
                  onClick={() => onAssign(s.customerId, s.name)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-brand/40 bg-white px-3 py-2 text-left transition hover:bg-brand-light disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-900">{s.name}</span>
                    <span className="block truncate text-[11px] text-neutral-500">{s.reasons[0]}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold text-brand-dark">
                    {s.confidence}%
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-500">Narration se koi naam nahi mila - customer chunein.</p>
          )}

          {txn.similarPending > 0 ? (
            <label className="flex items-center gap-2 text-[11px] text-neutral-600">
              <input
                type="checkbox"
                checked={applySimilar}
                onChange={(e) => onToggleApplySimilar(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300"
              />
              Isi payer ki {txn.similarPending} aur entry par bhi lagayein
            </label>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onPick}
              className="flex-1 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
            >
              {txn.suggestions.length ? "Koi aur customer" : "Customer chunein"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onIgnore}
              className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60"
            >
              Payment nahi
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onUndo}
            className="rounded-xl border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60"
          >
            Change
          </button>
        </div>
      )}
    </li>
  );
}

/** Full-screen customer search - the fallback when no suggestion is right. */
function CustomerPicker({
  txn,
  onClose,
  onChoose,
}: {
  txn: BankTxn;
  onClose: () => void;
  onChoose: (customerId: string, name: string) => void;
}) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/customers")
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setCustomers(body.customers ?? []);
      })
      .catch(() => {
        if (!cancelled) setCustomers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers;
    return list.slice(0, 100);
  }, [customers, query]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-neutral-900">
              ₹{formatInr(txn.amount)} · {shortDate(txn.date)}
            </p>
            <p className="truncate text-xs text-neutral-500">{txn.counterparty ?? txn.description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm">
            Close
          </button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Customer ka naam"
          className="mt-3 w-full rounded-xl border border-neutral-300 px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading ? (
          <p className="py-8 text-center text-sm text-neutral-500">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">Koi customer nahi mila.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {visible.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChoose(c.id, c.name)}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-900">{c.name}</span>
                    {c.phone ? <span className="block text-[11px] text-neutral-400">{c.phone}</span> : null}
                  </span>
                  {c.balance > 0 ? (
                    <span className="shrink-0 text-xs font-semibold text-overdue">₹{formatInr(c.balance)}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
