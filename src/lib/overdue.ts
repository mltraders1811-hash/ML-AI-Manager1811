import { prisma } from "@/lib/prisma";
import { getIstTodayRange, istStartOfDay } from "@/lib/dateIst";
import { formatInr } from "@/lib/format";

export const DEFAULT_REMINDER_TEMPLATE = [
  "Namaste {party} ji,",
  "",
  "Aapke {invoice_count} bill ka payment pending hai — kul ₹{amount}",
  "",
  "{invoice_lines}",
  "",
  "Kripya payment jaldi karne ki kripa karein.",
  "Dhanyawad — M.L. Traders",
].join("\n");

export const DEFAULT_CREDIT_DAYS = 25;

export const REMINDER_PLACEHOLDERS = [
  "party",
  "amount",
  "balance",
  "days",
  "invoice_count",
  "invoice_lines",
  "credit_days",
] as const;

export type OverdueInvoice = {
  invoiceId: string;
  date: string; // DD/MM/YYYY
  dateIso: string;
  dueDate: string; // DD/MM/YYYY
  invoiceNumber: string | null;
  /** True for a "Receivable opening balance" carried over from before this
   * backup's invoice history, rather than a bill raised in it. */
  isOpeningBalance: boolean;
  amount: number; // the invoice's own total
  unpaid: number; // how much of the party's balance this invoice accounts for
  daysOverdue: number; // days past the due date
  daysSince: number; // days since the invoice was raised
  isOverdue: boolean;
};

export type OverdueCustomerDetail = {
  customerId: string;
  party: string;
  phone: string | null;
  balance: number;
  overdueAmount: number;
  upcomingAmount: number;
  maxDaysOverdue: number;
  maxDaysSince: number;
  invoiceCount: number;
  creditDays: number;
  creditDaysCustom: boolean;
  invoices: OverdueInvoice[];
  reminderMessage: string;
  /** Follow-up state, so the list shows who has already been chased. */
  lastReminderAt: string | null;
  daysSinceReminder: number | null;
  reminderCount: number;
  /** How much they have paid off since that reminder was sent. Negative
   * means they bought more on credit rather than paying. Null when they've
   * never been reminded. */
  paidSinceReminder: number | null;
};

export type OverdueResult = {
  creditDays: number;
  asOf: string;
  reminderTemplate: string;
  summary: { customerCount: number; totalOverdue: number; totalOutstanding: number };
  customers: OverdueCustomerDetail[];
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDdMmYyyy(d: Date): string {
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / 86_400_000);
}

export function renderReminder(template: string, c: OverdueCustomerDetail): string {
  const lines = c.invoices
    .filter((i) => i.isOverdue)
    .map((i) =>
      i.isOpeningBalance
        ? `• Purana baki — ₹${formatInr(i.unpaid)} (${i.daysSince} din)`
        : `• ${i.date} — ₹${formatInr(i.unpaid)} (${i.daysSince} din)`,
    )
    .join("\n");

  const values: Record<string, string> = {
    party: c.party,
    amount: formatInr(c.overdueAmount),
    balance: formatInr(c.balance),
    days: String(c.maxDaysSince),
    invoice_count: String(c.invoiceCount),
    invoice_lines: lines,
    credit_days: String(c.creditDays),
  };

  let out = template;
  for (const [k, v] of Object.entries(values)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}

export async function getOverdueSettings(companyId: string) {
  const row = await prisma.overdueSettings.findUnique({ where: { companyId } });
  return {
    creditDays: row?.creditDays ?? DEFAULT_CREDIT_DAYS,
    reminderTemplate: row?.reminderTemplate ?? DEFAULT_REMINDER_TEMPLATE,
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * Customer-wise overdue receivables with invoice-level ageing.
 *
 * The amount a customer owes in total is Customer.currentBalance - Vyapar's
 * own running balance, which is the only figure that reflects payments (see
 * the comment on that field in schema.prisma). But that's a single number
 * with no age attached, and a reminder needs to say *which* bills are old.
 *
 * So we spread that balance back across the customer's invoices newest-first:
 * the newest invoice is assumed unpaid up to its own total, then the next,
 * until the balance is used up. Older invoices below the waterline are
 * treated as settled. This mirrors how these businesses actually apply
 * payments (oldest bills clear first) and yields a per-invoice "unpaid"
 * figure whose sum always equals the authoritative balance.
 *
 * An invoice counts as overdue once it is at least a day past
 * invoiceDate + creditDays, where creditDays is the customer's own term if
 * set, otherwise the company default (or an explicit override passed in).
 */
export async function getOverdueCustomers(
  companyId: string,
  creditDaysOverride?: number,
): Promise<OverdueResult> {
  const settings = await getOverdueSettings(companyId);
  const defaultCreditDays = creditDaysOverride ?? settings.creditDays;
  const { todayStart } = getIstTodayRange();

  const customers = await prisma.customer.findMany({
    where: { companyId },
    include: {
      // Only the latest reminder is needed for the list; the full history
      // is fetched per customer when the row is expanded.
      reminders: { orderBy: { sentAt: "desc" }, take: 1 },
      _count: { select: { reminders: true } },
      invoices: {
        // Opening balances are debt too - for 20 parties here it's their
        // ENTIRE balance, and leaving them out left those customers marked
        // overdue with no bills behind it and an empty reminder message.
        where: { type: { in: ["SALE", "OPENING_BALANCE"] } },
        orderBy: { invoiceDate: "desc" },
        select: { id: true, invoiceDate: true, invoiceNumber: true, totalAmount: true, type: true },
      },
    },
  });

  const result: OverdueCustomerDetail[] = [];
  let totalOverdue = 0;
  let totalOutstanding = 0;

  for (const cust of customers) {
    const balance = cust.currentBalance.toNumber();
    totalOutstanding += Math.max(0, balance);
    if (balance <= 0.9) continue;

    const creditDays =
      creditDaysOverride !== undefined ? creditDaysOverride : (cust.creditDays ?? settings.creditDays);

    let remaining = balance;
    const invoices: OverdueInvoice[] = [];
    let overdueAmount = 0;
    let upcomingAmount = 0;
    let maxDaysOverdue = 0;
    let maxDaysSince = 0;

    for (const inv of cust.invoices) {
      if (remaining <= 0.009) break;
      const total = inv.totalAmount.toNumber();
      if (total <= 0) continue;
      const unpaid = Math.min(total, remaining);
      remaining -= unpaid;

      const due = addDays(inv.invoiceDate, creditDays);
      const daysOverdue = daysBetween(todayStart, due);
      const daysSince = daysBetween(todayStart, inv.invoiceDate);
      const isOverdue = daysOverdue >= 1;

      if (isOverdue) {
        overdueAmount += unpaid;
        maxDaysOverdue = Math.max(maxDaysOverdue, daysOverdue);
        maxDaysSince = Math.max(maxDaysSince, daysSince);
      } else {
        upcomingAmount += unpaid;
      }

      invoices.push({
        invoiceId: inv.id,
        date: toDdMmYyyy(inv.invoiceDate),
        dateIso: toIso(inv.invoiceDate),
        dueDate: toDdMmYyyy(due),
        invoiceNumber: inv.invoiceNumber,
        isOpeningBalance: inv.type === "OPENING_BALANCE",
        amount: total,
        unpaid: Math.round(unpaid * 100) / 100,
        daysOverdue,
        daysSince,
        isOverdue,
      });
    }

    // Any balance we couldn't attribute to a specific invoice (opening
    // balance carried over from before this backup's history, say) is still
    // real money owed - count it as overdue rather than quietly dropping it.
    if (remaining > 0.9) {
      overdueAmount += remaining;
    }

    if (overdueAmount <= 0.9) continue;
    totalOverdue += overdueAmount;

    const lastReminder = cust.reminders[0] ?? null;
    const detail: OverdueCustomerDetail = {
      customerId: cust.id,
      party: cust.name,
      phone: cust.phone,
      balance: Math.round(balance * 100) / 100,
      overdueAmount: Math.round(overdueAmount * 100) / 100,
      upcomingAmount: Math.round(upcomingAmount * 100) / 100,
      maxDaysOverdue,
      maxDaysSince,
      invoiceCount: invoices.filter((i) => i.isOverdue).length,
      creditDays,
      creditDaysCustom: creditDaysOverride === undefined && cust.creditDays !== null,
      invoices,
      reminderMessage: "",
      lastReminderAt: lastReminder ? lastReminder.sentAt.toISOString() : null,
      // Calendar days, not elapsed hours: a reminder sent on Monday
      // afternoon is "2 din ago" on Wednesday morning, not "1".
      daysSinceReminder: lastReminder ? daysBetween(todayStart, istStartOfDay(lastReminder.sentAt)) : null,
      reminderCount: cust._count.reminders,
      paidSinceReminder: lastReminder
        ? Math.round((lastReminder.balanceAtSend.toNumber() - balance) * 100) / 100
        : null,
    };
    detail.reminderMessage = renderReminder(settings.reminderTemplate, detail);
    result.push(detail);
  }

  result.sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue || b.overdueAmount - a.overdueAmount);

  return {
    creditDays: defaultCreditDays,
    asOf: toIso(todayStart),
    reminderTemplate: settings.reminderTemplate,
    summary: {
      customerCount: result.length,
      totalOverdue: Math.round(totalOverdue * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    },
    customers: result,
  };
}
