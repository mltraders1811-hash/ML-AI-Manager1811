"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

import { formatInr } from "@/lib/format";
import { downloadBase64File } from "@/lib/downloadBase64";
import { brokerageApi, BrokerDetail } from "@/lib/brokerageApi";

export default function BrokerDetailPage({ params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = use(params);
  const brokerName = decodeURIComponent(name);
  const [broker, setBroker] = useState<BrokerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    brokerageApi
      .getBroker(id, brokerName)
      .then(setBroker)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load broker"))
      .finally(() => setLoading(false));
  }, [id, brokerName]);

  const onExport = async (fmt: "text" | "excel" | "pdf") => {
    setExporting(fmt);
    try {
      const result = await brokerageApi.exportBroker(id, brokerName, fmt);
      if (fmt === "text" && result.content) {
        await navigator.clipboard.writeText(result.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else if (result.base64 && result.mime) {
        downloadBase64File(result.base64, result.filename, result.mime);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  if (loading) return <main className="p-8 text-sm text-neutral-500">Loading…</main>;
  if (error || !broker) return <main className="p-8 text-sm text-overdue">{error || "Not found"}</main>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href={`/brokerage/report/${id}`} className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
        ← Report
      </Link>
      <h1 className="mt-1 text-xl font-bold text-neutral-900">{broker.name}</h1>
      <p className="text-sm text-neutral-500">
        {broker.transactionCount} transactions · ₹{formatInr(broker.totalAmount)} · brokerage ₹{formatInr(broker.totalBrokerage)}
      </p>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onExport("text")}
          disabled={exporting !== null}
          className="flex-1 rounded-lg bg-[#25D366] py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {copied ? "Copied!" : exporting === "text" ? "…" : "Copy WhatsApp Text"}
        </button>
        <button
          onClick={() => onExport("excel")}
          disabled={exporting !== null}
          className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-50"
        >
          {exporting === "excel" ? "…" : "Excel"}
        </button>
        <button
          onClick={() => onExport("pdf")}
          disabled={exporting !== null}
          className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-50"
        >
          {exporting === "pdf" ? "…" : "PDF"}
        </button>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Party</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Brokerage</th>
            </tr>
          </thead>
          <tbody>
            {broker.transactions.map((t, i) => (
              <tr key={i} className="border-b border-neutral-100 last:border-0">
                <td className="whitespace-nowrap px-3 py-2">{t.date}</td>
                <td className="px-3 py-2">{t.party}</td>
                <td className="px-3 py-2">{t.item}</td>
                <td className="px-3 py-2 text-right">{t.quantity}</td>
                <td className="px-3 py-2 text-right">₹{formatInr(t.price)}</td>
                <td className="px-3 py-2 text-right">₹{formatInr(t.amount)}</td>
                <td className="px-3 py-2 text-right text-brand">₹{formatInr(t.brokerage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
