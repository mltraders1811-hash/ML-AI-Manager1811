import { prisma } from "@/lib/prisma";
import { getIstTodayRange, getIstYesterdayRange } from "@/lib/dateIst";

export type QuickMetrics = {
  totalOutstanding: number;
  overdueAmount: number;
  overdueCount: number;
  yesterdaySales: number;
};

export async function getQuickMetrics(companyId: string): Promise<QuickMetrics> {
  const { tomorrowStart } = getIstTodayRange();
  const { yesterdayStart, todayStart } = getIstYesterdayRange();

  const [totalOutstandingAgg, overdueAgg, salesAgg] = await Promise.all([
    prisma.invoice.aggregate({
      where: { companyId, type: "SALE", balanceAmount: { gt: 0 } },
      _sum: { balanceAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { companyId, type: "SALE", balanceAmount: { gt: 0 }, dueDate: { lt: tomorrowStart } },
      _sum: { balanceAmount: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { companyId, type: "SALE", invoiceDate: { gte: yesterdayStart, lt: todayStart } },
      _sum: { totalAmount: true },
    }),
  ]);

  return {
    totalOutstanding: totalOutstandingAgg._sum.balanceAmount?.toNumber() ?? 0,
    overdueAmount: overdueAgg._sum.balanceAmount?.toNumber() ?? 0,
    overdueCount: overdueAgg._count,
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
 * One row per customer with an overdue balance, sorted by amount owed
 * (largest first) - this is the Action Center's "Smart List". The
 * oldest unpaid invoice's due date is what the WhatsApp reminder quotes
 * as "Due since" when a customer has more than one overdue invoice.
 */
export async function getOverdueCustomers(companyId: string): Promise<OverdueCustomer[]> {
  const { tomorrowStart, todayStart } = getIstTodayRange();

  const invoices = await prisma.invoice.findMany({
    where: { companyId, type: "SALE", balanceAmount: { gt: 0 }, dueDate: { lt: tomorrowStart } },
    include: { customer: true },
    orderBy: { dueDate: "asc" },
  });

  const byCustomer = new Map<string, OverdueCustomer>();
  for (const inv of invoices) {
    const balance = inv.balanceAmount.toNumber();
    const dueDate = inv.dueDate ?? inv.invoiceDate;
    const existing = byCustomer.get(inv.customerId);
    if (existing) {
      existing.totalOverdue += balance;
      existing.invoiceCount += 1;
      if (dueDate < existing.oldestDueDate) existing.oldestDueDate = dueDate;
    } else {
      byCustomer.set(inv.customerId, {
        customerId: inv.customerId,
        name: inv.customer.name,
        phone: inv.customer.phone,
        totalOverdue: balance,
        oldestDueDate: dueDate,
        daysOverdue: 0,
        invoiceCount: 1,
      });
    }
  }

  const result = Array.from(byCustomer.values());
  for (const c of result) {
    c.daysOverdue = Math.max(0, Math.floor((todayStart.getTime() - c.oldestDueDate.getTime()) / 86_400_000));
  }
  result.sort((a, b) => b.totalOverdue - a.totalOverdue);
  return result;
}

export async function getLastSyncRun(companyId: string) {
  return prisma.syncRun.findFirst({
    where: { companyId },
    orderBy: { startedAt: "desc" },
  });
}
