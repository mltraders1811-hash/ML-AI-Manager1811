import { prisma } from "@/lib/prisma";

export type InvoiceListRow = {
  id: string;
  invoiceNumber: string | null;
  dateIso: string;
  party: string;
  customerId: string;
  totalAmount: number;
  lineItemCount: number;
};

export type DaySummary = {
  dateIso: string;
  invoiceCount: number;
  totalAmount: number;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Sale days with an invoice count and day total, newest first - the index
 * for the daily browser. */
export async function listSaleDays(companyId: string, limit = 120): Promise<DaySummary[]> {
  // Grouping by the date part of a timestamp isn't expressible in Prisma's
  // groupBy, so this uses raw SQL. Dates are bucketed in IST (UTC+5:30) so a
  // day here means the shop's day, matching every other date in the app.
  const rows = await prisma.$queryRaw<{ date_iso: string; invoice_count: bigint; total_amount: number }[]>`
    SELECT to_char("invoiceDate" + interval '330 minutes', 'YYYY-MM-DD') AS date_iso,
           COUNT(*)                                                      AS invoice_count,
           COALESCE(SUM("totalAmount"), 0)::float8                       AS total_amount
    FROM "Invoice"
    WHERE "companyId" = ${companyId} AND "type" = 'SALE'
    GROUP BY date_iso
    ORDER BY date_iso DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    dateIso: r.date_iso,
    invoiceCount: Number(r.invoice_count),
    totalAmount: r.total_amount,
  }));
}

/** Every sale invoice raised on one IST calendar day. */
export async function listInvoicesForDay(companyId: string, dateIso: string): Promise<InvoiceListRow[]> {
  const [y, m, d] = dateIso.split("-").map(Number);
  if (!y || !m || !d) return [];
  // IST midnight is 18:30 UTC the previous day.
  const start = new Date(Date.UTC(y, m - 1, d, -5, -30));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const invoices = await prisma.invoice.findMany({
    where: { companyId, type: "SALE", invoiceDate: { gte: start, lt: end } },
    include: { customer: { select: { id: true, name: true } }, _count: { select: { lineItems: true } } },
    orderBy: { invoiceDate: "asc" },
  });

  return invoices.map((i) => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    dateIso: toIsoDate(i.invoiceDate),
    party: i.customer.name,
    customerId: i.customer.id,
    totalAmount: i.totalAmount.toNumber(),
    lineItemCount: i._count.lineItems,
  }));
}

/** Free-text search across party name and invoice number. */
export async function searchInvoices(companyId: string, query: string, limit = 100): Promise<InvoiceListRow[]> {
  const q = query.trim();
  if (!q) return [];

  const invoices = await prisma.invoice.findMany({
    where: {
      companyId,
      type: "SALE",
      OR: [
        { invoiceNumber: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    include: { customer: { select: { id: true, name: true } }, _count: { select: { lineItems: true } } },
    orderBy: { invoiceDate: "desc" },
    take: limit,
  });

  return invoices.map((i) => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    dateIso: toIsoDate(i.invoiceDate),
    party: i.customer.name,
    customerId: i.customer.id,
    totalAmount: i.totalAmount.toNumber(),
    lineItemCount: i._count.lineItems,
  }));
}

export type InvoiceDetail = {
  id: string;
  invoiceNumber: string | null;
  dateIso: string;
  party: string;
  partyPhone: string | null;
  totalAmount: number;
  lineItems: { id: string; itemName: string; quantity: number; unitPrice: number; amount: number }[];
};

export async function getInvoiceDetail(companyId: string, invoiceId: string): Promise<InvoiceDetail | null> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
    include: {
      customer: { select: { name: true, phone: true } },
      lineItems: { orderBy: { itemName: "asc" } },
    },
  });
  if (!inv) return null;

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    dateIso: toIsoDate(inv.invoiceDate),
    party: inv.customer.name,
    partyPhone: inv.customer.phone,
    totalAmount: inv.totalAmount.toNumber(),
    lineItems: inv.lineItems.map((li) => ({
      id: li.id,
      itemName: li.itemName,
      quantity: li.quantity.toNumber(),
      unitPrice: li.unitPrice.toNumber(),
      amount: li.amount.toNumber(),
    })),
  };
}
