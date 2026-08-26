import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/apiError";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function listPayments(companyId: string, reportId: string) {
  return prisma.brokeragePayment.findMany({
    where: { companyId, reportId },
    orderBy: { paidOn: "desc" },
  });
}

export async function addPayment(
  companyId: string,
  input: { reportId: string; broker: string; amount: number; note?: string; paidOn?: string },
) {
  if (input.amount <= 0) {
    throw new ApiError(400, "Amount must be greater than 0");
  }
  const report = await prisma.brokerageReport.findFirst({ where: { id: input.reportId, companyId } });
  if (!report) throw new ApiError(404, "Report not found");

  const broker = await prisma.brokerageBrokerSummary.findFirst({
    where: { reportId: input.reportId, name: { equals: input.broker, mode: "insensitive" } },
  });
  if (!broker) throw new ApiError(404, "Broker not found in this report");
  if (broker.isShopOwn) throw new ApiError(400, "No brokerage to pay on Shop Own Sales");

  return prisma.brokeragePayment.create({
    data: {
      companyId,
      reportId: input.reportId,
      broker: broker.name,
      amount: round2(input.amount),
      note: (input.note ?? "").trim(),
      paidOn: input.paidOn ?? todayIso(),
    },
  });
}

export async function deletePayment(companyId: string, paymentId: string): Promise<void> {
  const res = await prisma.brokeragePayment.deleteMany({ where: { id: paymentId, companyId } });
  if (res.count === 0) throw new ApiError(404, "Payment not found");
}

export async function settleAll(
  companyId: string,
  reportId: string,
  note?: string,
  paidOn?: string,
) {
  const report = await prisma.brokerageReport.findFirst({
    where: { id: reportId, companyId },
    include: { brokers: true },
  });
  if (!report) throw new ApiError(404, "Report not found");

  const existing = await prisma.brokeragePayment.findMany({ where: { companyId, reportId } });
  const paidByBroker = new Map<string, number>();
  for (const p of existing) {
    paidByBroker.set(p.broker, (paidByBroker.get(p.broker) ?? 0) + p.amount.toNumber());
  }

  const finalNote = note || "Settled in bulk";
  const finalPaidOn = paidOn || todayIso();

  const created = [];
  for (const b of report.brokers) {
    if (b.isShopOwn) continue;
    const owed = round2(b.totalBrokerage.toNumber());
    const paid = round2(paidByBroker.get(b.name) ?? 0);
    const balance = round2(owed - paid);
    if (balance <= 0.005) continue;
    const payment = await prisma.brokeragePayment.create({
      data: { companyId, reportId, broker: b.name, amount: balance, note: finalNote, paidOn: finalPaidOn },
    });
    created.push(payment);
  }
  return created;
}

export type BrokerPaymentSummary = {
  name: string;
  transactionCount: number;
  totalAmount: number;
  totalBrokerage: number;
  paid: number;
  balance: number;
  isSettled: boolean;
};

export async function paymentSummary(companyId: string, reportId: string) {
  const report = await prisma.brokerageReport.findFirst({
    where: { id: reportId, companyId },
    include: { brokers: true },
  });
  if (!report) throw new ApiError(404, "Report not found");

  const payments = await prisma.brokeragePayment.findMany({ where: { companyId, reportId } });
  const paidByBroker = new Map<string, number>();
  for (const p of payments) {
    paidByBroker.set(p.broker, (paidByBroker.get(p.broker) ?? 0) + p.amount.toNumber());
  }

  let totalDue = 0;
  let totalPaid = 0;
  const summary: BrokerPaymentSummary[] = [];
  for (const b of report.brokers) {
    if (b.isShopOwn) continue;
    const owed = round2(b.totalBrokerage.toNumber());
    const paid = round2(paidByBroker.get(b.name) ?? 0);
    const balance = round2(owed - paid);
    totalDue += owed;
    totalPaid += paid;
    summary.push({
      name: b.name,
      transactionCount: b.transactionCount,
      totalAmount: round2(b.totalAmount.toNumber()),
      totalBrokerage: owed,
      paid,
      balance,
      isSettled: balance <= 0.005,
    });
  }

  return {
    reportId,
    month: report.month,
    brokers: summary,
    totals: { totalDue: round2(totalDue), totalPaid: round2(totalPaid), balance: round2(totalDue - totalPaid) },
  };
}
