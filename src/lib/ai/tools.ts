import type Anthropic from "@anthropic-ai/sdk";

import { prisma } from "@/lib/prisma";
import { getIstTodayRange } from "@/lib/dateIst";
import { getOverdueCustomers, getQuickMetrics } from "@/lib/metrics";
import { topParties as brokerageTopParties } from "@/lib/brokerage/analyticsService";

// Every tool the AI chat assistant can call. Deliberately NOT "run this SQL
// the model wrote" - each tool is a fixed, parameterized query against our
// own schema, so the model can only ever ask questions we already know how
// to answer safely (no injection surface, no accidental cross-tenant leak,
// no destructive queries).

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_quick_metrics",
    description: "Get the headline numbers: total outstanding amount, total overdue amount, overdue invoice count, and yesterday's total sales.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_overdue_customers",
    description:
      "List customers with an overdue balance, sorted by amount owed (largest first). Use min_amount to filter, e.g. for 'who owes me more than 50k'.",
    input_schema: {
      type: "object",
      properties: {
        min_amount: { type: "number", description: "Only include customers overdue by at least this many rupees." },
        limit: { type: "number", description: "Max number of customers to return. Defaults to 20." },
      },
    },
  },
  {
    name: "search_customer_balance",
    description: "Look up a specific customer by (partial) name and return their outstanding balance and overdue invoices.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Customer name or part of it, case-insensitive." },
      },
      required: ["name"],
    },
  },
  {
    name: "get_sales_total_for_range",
    description: "Total sales amount and invoice count between two dates (inclusive), for questions like 'how much did I sell this week'.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "list_unpaid_brokers",
    description:
      "Brokerage commission balance owed to each broker, summed across every uploaded sale report (owed minus paid so far). This is a separate feature from customer dues - brokers earn 0.5% commission on sales, customers owe for goods bought on credit.",
    input_schema: {
      type: "object",
      properties: {
        broker_name: { type: "string", description: "Optional - filter to one broker by (partial) name, case-insensitive." },
      },
    },
  },
  {
    name: "get_latest_brokerage_report_summary",
    description: "Per-broker totals (transactions, sale amount, brokerage owed) from the most recently uploaded sale report.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_brokerage_top_parties",
    description: "Top buying parties across all uploaded sale reports, by total purchase amount.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max parties to return. Defaults to 10." } },
    },
  },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function executeTool(companyId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_quick_metrics":
      return getQuickMetrics(companyId);

    case "list_overdue_customers": {
      const minAmount = typeof input.min_amount === "number" ? input.min_amount : undefined;
      const limit = typeof input.limit === "number" ? input.limit : 20;
      const customers = await getOverdueCustomers(companyId);
      const filtered = minAmount !== undefined ? customers.filter((c) => c.totalOverdue >= minAmount) : customers;
      return filtered.slice(0, limit).map((c) => ({
        name: c.name,
        phone: c.phone,
        total_overdue: Math.round(c.totalOverdue * 100) / 100,
        days_overdue: c.daysOverdue,
        invoice_count: c.invoiceCount,
      }));
    }

    case "search_customer_balance": {
      const name = String(input.name ?? "").trim();
      if (!name) return { error: "name is required" };
      const customers = await prisma.customer.findMany({
        where: { companyId, name: { contains: name, mode: "insensitive" } },
        take: 5,
      });
      if (customers.length === 0) return { error: `No customer found matching "${name}"` };

      const { tomorrowStart } = getIstTodayRange();
      const results = await Promise.all(
        customers.map(async (customer) => {
          // Total owed comes from Customer.currentBalance (Vyapar's own
          // per-party running balance) - see the note on that field in
          // schema.prisma for why individual invoices' balanceAmount can't
          // be trusted for this. Due dates are still used to say whether
          // (and since when) this customer is overdue.
          const totalOutstanding = customer.currentBalance.toNumber();
          const overdueInvoiceCount = await prisma.invoice.count({
            where: { companyId, customerId: customer.id, type: "SALE", dueDate: { lt: tomorrowStart } },
          });
          return {
            name: customer.name,
            phone: customer.phone,
            total_outstanding: totalOutstanding,
            overdue_amount: overdueInvoiceCount > 0 ? totalOutstanding : 0,
            past_due_invoice_count: overdueInvoiceCount,
          };
        }),
      );
      return results;
    }

    case "get_sales_total_for_range": {
      const start = new Date(String(input.start_date));
      const endExclusive = new Date(String(input.end_date));
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1); // end_date is inclusive
      if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) {
        return { error: "start_date and end_date must be YYYY-MM-DD" };
      }
      const agg = await prisma.invoice.aggregate({
        where: { companyId, type: "SALE", invoiceDate: { gte: start, lt: endExclusive } },
        _sum: { totalAmount: true },
        _count: true,
      });
      return {
        total_sales: agg._sum.totalAmount?.toNumber() ?? 0,
        invoice_count: agg._count,
      };
    }

    case "list_unpaid_brokers": {
      const nameFilter = typeof input.broker_name === "string" ? input.broker_name.toLowerCase() : undefined;
      const summaries = await prisma.brokerageBrokerSummary.findMany({
        where: { report: { companyId }, isShopOwn: false },
      });
      const owedByBroker = new Map<string, number>();
      for (const s of summaries) {
        owedByBroker.set(s.name, (owedByBroker.get(s.name) ?? 0) + s.totalBrokerage.toNumber());
      }
      const payments = await prisma.brokeragePayment.findMany({ where: { companyId } });
      const paidByBroker = new Map<string, number>();
      for (const p of payments) {
        paidByBroker.set(p.broker, (paidByBroker.get(p.broker) ?? 0) + p.amount.toNumber());
      }
      let results = Array.from(owedByBroker.entries()).map(([broker, owed]) => {
        const paid = paidByBroker.get(broker) ?? 0;
        return { broker, total_owed: round2(owed), total_paid: round2(paid), balance: round2(owed - paid) };
      });
      if (nameFilter) results = results.filter((r) => r.broker.toLowerCase().includes(nameFilter));
      return results
        .filter((r) => r.balance > 0.005)
        .sort((a, b) => b.balance - a.balance);
    }

    case "get_latest_brokerage_report_summary": {
      const report = await prisma.brokerageReport.findFirst({
        where: { companyId },
        orderBy: { uploadedAt: "desc" },
        include: { brokers: true },
      });
      if (!report) return { error: "No sale reports uploaded yet" };
      return {
        filename: report.filename,
        month: report.month,
        brokers: report.brokers.map((b) => ({
          name: b.name,
          is_shop_own: b.isShopOwn,
          transaction_count: b.transactionCount,
          total_amount: b.totalAmount.toNumber(),
          total_brokerage: b.totalBrokerage.toNumber(),
        })),
      };
    }

    case "get_brokerage_top_parties": {
      const limit = typeof input.limit === "number" ? input.limit : 10;
      const result = await brokerageTopParties(companyId, undefined, limit);
      return result.parties.map((p) => ({ name: p.name, amount: p.amount, purchases: p.txns }));
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
