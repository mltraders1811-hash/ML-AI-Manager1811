import type Anthropic from "@anthropic-ai/sdk";

import { prisma } from "@/lib/prisma";
import { getIstTodayRange } from "@/lib/dateIst";
import { getOverdueCustomers, getQuickMetrics } from "@/lib/metrics";

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
];

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

      const results = await Promise.all(
        customers.map(async (customer) => {
          const invoices = await prisma.invoice.findMany({
            where: { companyId, customerId: customer.id, type: "SALE", balanceAmount: { gt: 0 } },
            orderBy: { dueDate: "asc" },
          });
          const { tomorrowStart } = getIstTodayRange();
          const overdueInvoices = invoices.filter((i) => i.dueDate && i.dueDate < tomorrowStart);
          return {
            name: customer.name,
            phone: customer.phone,
            total_outstanding: invoices.reduce((sum, i) => sum + i.balanceAmount.toNumber(), 0),
            overdue_amount: overdueInvoices.reduce((sum, i) => sum + i.balanceAmount.toNumber(), 0),
            open_invoice_count: invoices.length,
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

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
