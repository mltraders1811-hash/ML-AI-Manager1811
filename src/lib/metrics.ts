import { prisma } from "@/lib/prisma";
import { getIstTodayRange, getIstYesterdayRange } from "@/lib/dateIst";

export type QuickMetrics = {
  totalOutstanding: number;
  overdueAmount: number;
  overdueCount: number;
  yesterdaySales: number;
};

export async function getQuickMetrics(companyId: string): Promise<QuickMetrics> {
  const { yesterdayStart, todayStart } = getIstYesterdayRange();

  const [totalOutstandingAgg, overdueCustomers, salesAgg] = await Promise.all([
    prisma.customer.aggregate({
      where: { companyId, currentBalance: { gt: 0 } },
      _sum: { currentBalance: true },
    }),
    getOverdueCustomers(companyId),
    prisma.invoice.aggregate({
      where: { companyId, type: "SALE", invoiceDate: { gte: yesterdayStart, lt: todayStart } },
      _sum: { totalAmount: true },
    }),
  ]);

  return {
    totalOutstanding: totalOutstandingAgg._sum.currentBalance?.toNumber() ?? 0,
    overdueAmount: overdueCustomers.reduce((sum, c) => sum + c.totalOverdue, 0),
    // Counts customers with overdue debt, not individual invoices - see
    // the note on getOverdueCustomers below for why invoice-level counts
    // aren't reliable here.
    overdueCount: overdueCustomers.length,
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
 * (largest first) - this is the Action Center's "Smart List".
 *
 * The amount owed (totalOverdue) comes from Customer.currentBalance -
 * Vyapar's own per-party running balance - NOT from summing individual
 * overdue invoices' balanceAmount, which is unreliable (see the comment on
 * Customer.currentBalance in schema.prisma). Invoice due dates are still
 * used to decide *whether* a customer counts as overdue and since when:
 * a customer qualifies if they have a positive currentBalance AND at
 * least one SALE invoice whose due date has passed. invoiceCount reflects
 * how many such past-due invoices exist on file - useful context, but
 * don't read it as "this many invoices are still unpaid".
 */
export async function getOverdueCustomers(companyId: string): Promise<OverdueCustomer[]> {
  const { tomorrowStart, todayStart } = getIstTodayRange();

  const invoices = await prisma.invoice.findMany({
    where: { companyId, type: "SALE", dueDate: { lt: tomorrowStart } },
    include: { customer: true },
    orderBy: { dueDate: "asc" },
  });

  const byCustomer = new Map<string, OverdueCustomer>();
  for (const inv of invoices) {
    const dueDate = inv.dueDate ?? inv.invoiceDate;
    const existing = byCustomer.get(inv.customerId);
    if (existing) {
      existing.invoiceCount += 1;
      if (dueDate < existing.oldestDueDate) existing.oldestDueDate = dueDate;
    } else {
      byCustomer.set(inv.customerId, {
        customerId: inv.customerId,
        name: inv.customer.name,
        phone: inv.customer.phone,
        totalOverdue: inv.customer.currentBalance.toNumber(),
        oldestDueDate: dueDate,
        daysOverdue: 0,
        invoiceCount: 1,
      });
    }
  }

  const result = Array.from(byCustomer.values()).filter((c) => c.totalOverdue > 0);
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
