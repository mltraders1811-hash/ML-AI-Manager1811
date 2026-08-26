import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/apiError";

import type { ParsedSaleReport } from "./types";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

async function insertBrokers(tx: Tx, companyId: string, reportId: string, brokers: ParsedSaleReport["brokers"]) {
  for (const broker of brokers) {
    const summary = await tx.brokerageBrokerSummary.create({
      data: {
        companyId,
        reportId,
        name: broker.name,
        isShopOwn: broker.isShopOwn,
        totalQty: broker.totalQty,
        totalAmount: broker.totalAmount,
        totalBrokerage: broker.totalBrokerage,
        transactionCount: broker.transactionCount,
      },
    });
    if (broker.transactions.length > 0) {
      await tx.brokerageTransaction.createMany({
        data: broker.transactions.map((t) => ({
          companyId,
          brokerSummaryId: summary.id,
          date: t.date,
          dateIso: t.dateIso,
          party: t.party,
          item: t.item,
          quantity: t.quantity,
          price: t.price,
          amount: t.amount,
          brokerage: t.brokerage,
        })),
      });
    }
  }
}

export async function saveParsedReport(
  companyId: string,
  filename: string,
  fileSize: number,
  parsed: ParsedSaleReport,
) {
  return prisma.$transaction(async (tx) => {
    const report = await tx.brokerageReport.create({
      data: {
        companyId,
        filename,
        fileSize,
        month: parsed.month,
        source: "UPLOAD",
        totalTransactions: parsed.summary.totalTransactions,
        totalAmount: parsed.summary.totalAmount,
        totalBrokerage: parsed.summary.totalBrokerage,
        brokerCount: parsed.summary.brokerCount,
        shopOwnCount: parsed.summary.shopOwnCount,
      },
    });
    await insertBrokers(tx, companyId, report.id, parsed.brokers);
    return report;
  });
}

/**
 * Upserts a report derived from the daily Vyapar sync, keyed by
 * (companyId, month, source=VYAPAR_SYNC). Keeps the report's id stable
 * across re-syncs (only its broker/transaction children are replaced) so
 * any BrokeragePayment rows recorded against it - linked by reportId -
 * survive the next day's re-derivation instead of being cascade-deleted.
 */
export async function upsertDerivedReport(companyId: string, month: string, sourceLabel: string, parsed: ParsedSaleReport) {
  return prisma.$transaction(async (tx) => {
    const report = await tx.brokerageReport.upsert({
      where: { companyId_month_source: { companyId, month, source: "VYAPAR_SYNC" } },
      update: {
        filename: sourceLabel,
        uploadedAt: new Date(),
        totalTransactions: parsed.summary.totalTransactions,
        totalAmount: parsed.summary.totalAmount,
        totalBrokerage: parsed.summary.totalBrokerage,
        brokerCount: parsed.summary.brokerCount,
        shopOwnCount: parsed.summary.shopOwnCount,
      },
      create: {
        companyId,
        month,
        source: "VYAPAR_SYNC",
        filename: sourceLabel,
        fileSize: 0,
        totalTransactions: parsed.summary.totalTransactions,
        totalAmount: parsed.summary.totalAmount,
        totalBrokerage: parsed.summary.totalBrokerage,
        brokerCount: parsed.summary.brokerCount,
        shopOwnCount: parsed.summary.shopOwnCount,
      },
    });

    // Broker summaries/transactions are fully replaced each sync (cheap -
    // one month's worth of rows); BrokeragePayment is untouched since it's
    // only linked to the stable report id, not to these children.
    await tx.brokerageBrokerSummary.deleteMany({ where: { reportId: report.id } });
    await insertBrokers(tx, companyId, report.id, parsed.brokers);

    return report;
  });
}

export async function listReports(companyId: string) {
  return prisma.brokerageReport.findMany({
    where: { companyId },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      filename: true,
      fileSize: true,
      uploadedAt: true,
      month: true,
      totalTransactions: true,
      totalAmount: true,
      totalBrokerage: true,
      brokerCount: true,
      shopOwnCount: true,
    },
  });
}

export async function getReportWithBrokers(companyId: string, reportId: string) {
  const report = await prisma.brokerageReport.findFirst({
    where: { id: reportId, companyId },
    include: { brokers: { orderBy: { name: "asc" } } },
  });
  if (!report) throw new ApiError(404, "Report not found");
  return report;
}

export async function getBrokerDetail(companyId: string, reportId: string, brokerName: string) {
  const report = await prisma.brokerageReport.findFirst({ where: { id: reportId, companyId } });
  if (!report) throw new ApiError(404, "Report not found");

  const broker = await prisma.brokerageBrokerSummary.findFirst({
    where: { reportId, name: { equals: brokerName, mode: "insensitive" } },
    include: { transactions: { orderBy: { dateIso: "asc" } } },
  });
  if (!broker) throw new ApiError(404, "Broker not found");
  return { report, broker };
}

export async function deleteReport(companyId: string, reportId: string): Promise<void> {
  const res = await prisma.brokerageReport.deleteMany({ where: { id: reportId, companyId } });
  if (res.count === 0) throw new ApiError(404, "Report not found");
}
