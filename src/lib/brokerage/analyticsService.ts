import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/apiError";

import { orderBrokers } from "./brokerRules";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Reports grouped by month, keeping only the most recently uploaded
 * report for months with more than one upload. */
async function latestReportPerMonth(companyId: string) {
  const reports = await prisma.brokerageReport.findMany({
    where: { companyId, month: { not: null } },
    orderBy: { uploadedAt: "desc" },
  });
  const byMonth = new Map<string, (typeof reports)[number]>();
  for (const r of reports) {
    if (!r.month || byMonth.has(r.month)) continue; // desc order -> first seen is latest
    byMonth.set(r.month, r);
  }
  return byMonth;
}

export async function monthlyComparison(companyId: string) {
  const byMonth = await latestReportPerMonth(companyId);
  const months = Array.from(byMonth.keys()).sort();
  if (months.length === 0) return { months: [], brokers: [], monthTotals: [] };

  const reportIds = months.map((m) => byMonth.get(m)!.id);
  const summaries = await prisma.brokerageBrokerSummary.findMany({ where: { reportId: { in: reportIds } } });

  type BrokerMonthly = {
    name: string;
    isShopOwn: boolean;
    monthly: Record<string, { amount: number; brokerage: number; txns: number }>;
    totalAmount: number;
    totalBrokerage: number;
    totalTxns: number;
  };
  const brokerData: Record<string, BrokerMonthly> = {};

  for (const m of months) {
    const reportId = byMonth.get(m)!.id;
    for (const b of summaries.filter((s) => s.reportId === reportId)) {
      let info = brokerData[b.name];
      if (!info) {
        info = { name: b.name, isShopOwn: b.isShopOwn, monthly: {}, totalAmount: 0, totalBrokerage: 0, totalTxns: 0 };
        brokerData[b.name] = info;
      }
      const amount = round2(b.totalAmount.toNumber());
      const brokerage = round2(b.totalBrokerage.toNumber());
      info.monthly[m] = { amount, brokerage, txns: b.transactionCount };
      info.totalAmount += amount;
      info.totalBrokerage += brokerage;
      info.totalTxns += b.transactionCount;
    }
  }
  for (const info of Object.values(brokerData)) {
    for (const m of months) {
      if (!info.monthly[m]) info.monthly[m] = { amount: 0, brokerage: 0, txns: 0 };
    }
    info.totalAmount = round2(info.totalAmount);
    info.totalBrokerage = round2(info.totalBrokerage);
  }

  const ordered = orderBrokers(brokerData);

  const monthTotals = months.map((m) => {
    const report = byMonth.get(m)!;
    return {
      month: m,
      totalAmount: report.totalAmount.toNumber(),
      totalBrokerage: report.totalBrokerage.toNumber(),
      totalTransactions: report.totalTransactions,
    };
  });

  return { months, brokers: ordered, monthTotals };
}

type PartyAgg = { name: string; amount: number; qty: number; txns: number; lastDate: string | null };

async function aggregatePartiesForReports(reportIds: string[]): Promise<Record<string, PartyAgg>> {
  if (reportIds.length === 0) return {};
  const transactions = await prisma.brokerageTransaction.findMany({
    where: { brokerSummary: { reportId: { in: reportIds } } },
    select: { party: true, amount: true, quantity: true, dateIso: true },
  });
  const parties: Record<string, PartyAgg> = {};
  for (const t of transactions) {
    const party = t.party.trim();
    if (!party) continue;
    let agg = parties[party];
    if (!agg) {
      agg = { name: party, amount: 0, qty: 0, txns: 0, lastDate: null };
      parties[party] = agg;
    }
    agg.amount += t.amount.toNumber();
    agg.qty += t.quantity.toNumber();
    agg.txns += 1;
    if (t.dateIso && (!agg.lastDate || t.dateIso > agg.lastDate)) agg.lastDate = t.dateIso;
  }
  for (const p of Object.values(parties)) {
    p.amount = round2(p.amount);
    p.qty = round2(p.qty);
  }
  return parties;
}

export async function topParties(companyId: string, month: string | undefined, limit: number) {
  let reportIds: string[];
  if (month) {
    const reports = await prisma.brokerageReport.findMany({
      where: { companyId, month },
      orderBy: { uploadedAt: "desc" },
      take: 1,
    });
    reportIds = reports.map((r) => r.id);
  } else {
    const reports = await prisma.brokerageReport.findMany({ where: { companyId }, select: { id: true } });
    reportIds = reports.map((r) => r.id);
  }

  const parties = await aggregatePartiesForReports(reportIds);
  const items = Object.values(parties)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
  return { month: month ?? null, count: Object.keys(parties).length, parties: items };
}

export async function inactiveParties(companyId: string, month: string | undefined, dropThreshold: number) {
  const byMonth = await latestReportPerMonth(companyId);
  const months = Array.from(byMonth.keys()).sort();
  if (months.length === 0) return { currentMonth: null, prevMonth: null, parties: [] as unknown[] };

  const currentMonth = month ?? months[months.length - 1]!;
  if (!byMonth.has(currentMonth)) {
    throw new ApiError(404, `No report for month ${currentMonth}`);
  }

  const idx = months.indexOf(currentMonth);
  if (idx === 0) {
    return {
      currentMonth,
      prevMonth: null,
      parties: [] as unknown[],
      note: "No previous month report available for comparison.",
    };
  }
  const prevMonth = months[idx - 1]!;

  const curParties = await aggregatePartiesForReports([byMonth.get(currentMonth)!.id]);
  const prevParties = await aggregatePartiesForReports([byMonth.get(prevMonth)!.id]);

  const drops: {
    name: string;
    previousAmount: number;
    currentAmount: number;
    dropAmount: number;
    dropPct: number;
    status: "missing" | "decreased";
    lastPurchase: string | null;
  }[] = [];

  for (const [name, prev] of Object.entries(prevParties)) {
    const cur = curParties[name] ?? { name, amount: 0, qty: 0, txns: 0, lastDate: null };
    if (prev.amount <= 0) continue;
    const dropAmount = prev.amount - cur.amount;
    const dropPct = (dropAmount / prev.amount) * 100;
    let status: "missing" | "decreased";
    if (cur.amount === 0) status = "missing";
    else if (dropPct >= dropThreshold) status = "decreased";
    else continue;
    drops.push({
      name,
      previousAmount: round2(prev.amount),
      currentAmount: round2(cur.amount),
      dropAmount: round2(dropAmount),
      dropPct: round1(dropPct),
      status,
      lastPurchase: prev.lastDate,
    });
  }
  drops.sort((a, b) => b.dropAmount - a.dropAmount);

  return { currentMonth, prevMonth, thresholdPct: dropThreshold, parties: drops, count: drops.length };
}
