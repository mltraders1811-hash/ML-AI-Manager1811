import { prisma } from "@/lib/prisma";
import { getIstTodayRange, getIstYesterdayRange } from "@/lib/dateIst";
import { getOverdueCustomers as getOverdueDetail } from "@/lib/overdue";

export type QuickMetrics = {
  totalOutstanding: number;
  overdueAmount: number;
  overdueCount: number;
  yesterdaySales: number;
};

export async function getQuickMetrics(companyId: string): Promise<QuickMetrics> {
  const { yesterdayStart, todayStart } = getIstYesterdayRange();

  const [overdue, salesAgg] = await Promise.all([
    getOverdueDetail(companyId),
    prisma.invoice.aggregate({
      where: { companyId, type: "SALE", invoiceDate: { gte: yesterdayStart, lt: todayStart } },
      _sum: { totalAmount: true },
    }),
  ]);

  return {
    totalOutstanding: overdue.summary.totalOutstanding,
    overdueAmount: overdue.summary.totalOverdue,
    // Customers with overdue debt, not individual invoices.
    overdueCount: overdue.summary.customerCount,
    yesterdaySales: salesAgg._sum.totalAmount?.toNumber() ?? 0,
  };
}

export type OverdueCustomer = {
  customerId: string;
  name: string;
  phone: string | null;
  totalOverdue: number;
  oldestDueDate: Date;
  daysOverdue: number;
  invoiceCount: number;
};

/**
 * One row per customer with an overdue balance - the Action Center's
 * "Smart List". A flattened view of src/lib/overdue.ts, which owns the real
 * logic (per-customer credit terms, per-invoice ageing); this keeps the
 * dashboard's simpler shape without duplicating that calculation.
 */
export async function getOverdueCustomers(companyId: string): Promise<OverdueCustomer[]> {
  const { customers } = await getOverdueDetail(companyId);
  return customers.map((c) => ({
    customerId: c.customerId,
    name: c.party,
    phone: c.phone,
    totalOverdue: c.overdueAmount,
    // The oldest still-unpaid bill is what a reminder should quote as
    // "due since"; fall back to today when a balance couldn't be tied to a
    // specific invoice (see the unattributed-remainder note in overdue.ts).
    oldestDueDate: (() => {
      const overdueInvoices = c.invoices.filter((i) => i.isOverdue);
      if (overdueInvoices.length === 0) return new Date();
      const oldest = overdueInvoices[overdueInvoices.length - 1]!;
      const [dd, mm, yyyy] = oldest.dueDate.split("/").map(Number);
      return new Date(Date.UTC(yyyy!, mm! - 1, dd!));
    })(),
    daysOverdue: c.maxDaysOverdue,
    invoiceCount: c.invoiceCount,
  }));
}

export async function getLastSyncRun(companyId: string) {
  return prisma.syncRun.findFirst({
    where: { companyId },
    orderBy: { startedAt: "desc" },
  });
}
