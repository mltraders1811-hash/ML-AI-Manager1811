"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { formatInr } from "@/lib/format";
import { brokerageApi, Payment, PaymentSummary } from "@/lib/brokerageApi";

export default function PaymentsPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = use(params);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payingBroker, setPayingBroker] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [s, p] = await Promise.all([brokerageApi.paymentSummary(reportId), brokerageApi.listPayments(reportId)]);
      setSummary(s);
      setPayments(p.payments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payments");
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    load();
  }, [load]);

  const openPay = (broker: string, balance: number) => {
    setPayingBroker(broker);
    setAmount(balance > 0 ? balance.toFixed(2) : "");
    setNote("");
  };

  const submitPay = async () => {
    if (!payingBroker) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setBusy(true);
    try {
      await brokerageApi.addPayment({ reportId, broker: payingBroker, amount: amt, note: note || undefined });
      setPayingBroker(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const onSettleAll = async () => {
    if (!confirm("Record payments equal to every broker's remaining balance?")) return;
    setBusy(true);
    try {
      await brokerageApi.settleAll(reportId, "Settled in bulk");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settle-all failed");
    } finally {
      setBusy(false);
    }
  };

  const onDeletePayment = async (id: string) => {
    if (!confirm("Delete this payment record?")) return;
    try {
      await brokerageApi.deletePayment(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading) return <main className="p-8 text-sm text-neutral-500">Loading…</main>;
  if (error && !summary) return <main className="p-8 text-sm text-overdue">{error}</main>;
  if (!summary) return null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href={`/brokerage/report/${reportId}`} className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
        ← Report
      </Link>
      <h1 className="mt-1 text-xl font-bold text-neutral-900">Brokerage Payments</h1>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-3 text-center">
          <p className="text-xs text-neutral-400">Total Due</p>
          <p className="font-bold">₹{formatInr(summary.totals.totalDue)}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3 text-center">
          <p className="text-xs text-neutral-400">Paid</p>
          <p className="font-bold text-brand">₹{formatInr(summary.totals.totalPaid)}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3 text-center">
          <p className="text-xs text-neutral-400">Balance</p>
          <p className="font-bold text-overdue">₹{formatInr(summary.totals.balance)}</p>
        </div>
      </div>

      {summary.totals.balance > 0.005 ? (
        <button
          onClick={onSettleAll}
          disabled={busy}
          className="mt-4 w-full rounded-lg border border-brand py-2 text-sm font-semibold text-brand disabled:opacity-50"
        >
          Settle All
        </button>
      ) : null}

      {error ? <p className="mt-3 text-sm text-overdue">{error}</p> : null}

      <div className="mt-6 space-y-3">
        {summary.brokers.map((b) => (
          <div key={b.name} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-neutral-900">{b.name}</p>
              {b.isSettled ? (
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">SETTLED</span>
              ) : (
                <button onClick={() => openPay(b.name, b.balance)} className="text-xs font-semibold text-brand hover:underline">
                  Record payment
                </button>
              )}
            </div>
            <div className="mt-2 flex gap-6 text-sm">
              <span className="text-neutral-500">
                Owed: <span className="font-medium text-neutral-800">₹{formatInr(b.totalBrokerage)}</span>
              </span>
              <span className="text-neutral-500">
                Paid: <span className="font-medium text-neutral-800">₹{formatInr(b.paid)}</span>
              </span>
              <span className="text-neutral-500">
                Balance: <span className="font-medium text-overdue">₹{formatInr(b.balance)}</span>
              </span>
            </div>
          </div>
        ))}
      </div>

      {payingBroker ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4" onClick={() => setPayingBroker(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-neutral-900">Pay {payingBroker}</h2>
            <label className="mt-4 block text-xs font-medium text-neutral-500">Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
            <label className="mt-3 block text-xs font-medium text-neutral-500">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2" />
            <div className="mt-5 flex gap-2">
              <button onClick={() => setPayingBroker(null)} className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium">
                Cancel
              </button>
              <button onClick={submitPay} disabled={busy} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-neutral-500">Payment History</h2>
      {payments.length === 0 ? (
        <p className="text-sm text-neutral-400">No payments recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  {p.broker} — ₹{formatInr(p.amount)}
                </p>
                <p className="text-xs text-neutral-500">
                  {p.paidOn}
                  {p.note ? ` · ${p.note}` : ""}
                </p>
              </div>
              <button onClick={() => onDeletePayment(p.id)} className="text-xs font-medium text-overdue hover:underline">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
