import { prisma } from "@/lib/prisma";
import { getSyncEnv } from "@/lib/env";
import { upsertDerivedReport } from "@/lib/brokerage/reportService";

import { downloadFile, findLatestBackup } from "./driveClient";
import { cleanupExtractDir, unpackVyb } from "./unpackVyb";
import { readVyaparExtract } from "./vyaparReader";
import { deriveBrokerageByMonth } from "./brokerageFromVyapar";
import type { VyaparExtract } from "./types";

export type SyncSummary = {
  sourceFileName: string;
  customersUpserted: number;
  invoicesUpserted: number;
  lineItemsUpserted: number;
  inventoryUpserted: number;
  brokerageReportsUpserted: number;
  warnings: string[];
};

// Only recent months are re-derived into BrokerageReport on every daily
// sync - reprocessing years of already-settled Vyapar history on every run
// would be wasted work. A broker's own commission month closes out well
// within this window in practice.
const BROKERAGE_SYNC_RECENT_MONTHS = 2;

function recentMonthKeys(count: number): Set<string> {
  const keys = new Set<string>();
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

async function syncDerivedBrokerage(companyId: string, extract: VyaparExtract, sourceFileName: string): Promise<number> {
  const reportsByMonth = deriveBrokerageByMonth(extract);
  const recentMonths = recentMonthKeys(BROKERAGE_SYNC_RECENT_MONTHS);

  let upserted = 0;
  for (const [month, parsed] of reportsByMonth) {
    if (!recentMonths.has(month)) continue;
    await upsertDerivedReport(companyId, month, `Vyapar sync: ${sourceFileName}`, parsed);
    upserted++;
  }
  return upserted;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export async function persistExtract(
  companyId: string,
  extract: VyaparExtract,
  defaultPaymentTermsDays: number,
): Promise<Omit<SyncSummary, "sourceFileName" | "brokerageReportsUpserted">> {
  const warnings: string[] = [];

  // --- Customers first, so invoices can resolve their internal id ---
  const customerIdByExternalId = new Map<string, string>();
  let customersUpserted = 0;
  for (const c of extract.customers) {
    try {
      const row = await prisma.customer.upsert({
        where: { companyId_externalId: { companyId, externalId: c.externalId } },
        update: {
          name: c.name,
          // Only overwrite contact details when Vyapar actually has them.
          // Numbers added by hand in the phone book (for parties Vyapar has
          // no number for) must survive the next sync, which would otherwise
          // blank them out every night.
          ...(c.phone ? { phone: c.phone } : {}),
          ...(c.email ? { email: c.email } : {}),
          ...(c.address ? { address: c.address } : {}),
          currentBalance: c.currentBalance,
        },
        create: {
          companyId,
          externalId: c.externalId,
          name: c.name,
          phone: c.phone,
          email: c.email,
          address: c.address,
          currentBalance: c.currentBalance,
        },
      });
      customerIdByExternalId.set(c.externalId, row.id);
      customersUpserted++;
    } catch (e) {
      warnings.push(`Customer ${c.externalId} (${c.name}): ${(e as Error).message}`);
    }
  }

  // --- Invoices, skipping any whose customer we couldn't resolve ---
  const invoiceIdByExternalId = new Map<string, string>();
  let invoicesUpserted = 0;
  for (const inv of extract.invoices) {
    const customerId = customerIdByExternalId.get(inv.customerExternalId);
    if (!customerId) {
      warnings.push(`Invoice ${inv.externalId}: unknown customer ${inv.customerExternalId}, skipped`);
      continue;
    }
    const balanceAmount = Math.max(0, inv.totalAmount - inv.paidAmount);
    const dueDate = inv.dueDate ?? addDays(inv.invoiceDate, defaultPaymentTermsDays);
    try {
      const row = await prisma.invoice.upsert({
        where: { companyId_externalId: { companyId, externalId: inv.externalId } },
        update: {
          customerId,
          type: inv.type,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          dueDate,
          totalAmount: inv.totalAmount,
          paidAmount: inv.paidAmount,
          balanceAmount,
        },
        create: {
          companyId,
          externalId: inv.externalId,
          customerId,
          type: inv.type,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          dueDate,
          totalAmount: inv.totalAmount,
          paidAmount: inv.paidAmount,
          balanceAmount,
        },
      });
      invoiceIdByExternalId.set(inv.externalId, row.id);
      invoicesUpserted++;
    } catch (e) {
      warnings.push(`Invoice ${inv.externalId}: ${(e as Error).message}`);
    }
  }

  // --- Line items ---
  let lineItemsUpserted = 0;
  for (const li of extract.lineItems) {
    const invoiceId = invoiceIdByExternalId.get(li.invoiceExternalId);
    if (!invoiceId) continue; // parent invoice was skipped/unresolvable; not worth a warning per-line
    try {
      await prisma.invoiceLineItem.upsert({
        where: { companyId_externalId: { companyId, externalId: li.externalId } },
        update: {
          invoiceId,
          itemName: li.itemName,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          amount: li.amount,
        },
        create: {
          companyId,
          externalId: li.externalId,
          invoiceId,
          itemName: li.itemName,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          amount: li.amount,
        },
      });
      lineItemsUpserted++;
    } catch (e) {
      warnings.push(`Line item ${li.externalId}: ${(e as Error).message}`);
    }
  }

  // --- Inventory (background sync only, no V1 UI) ---
  let inventoryUpserted = 0;
  for (const item of extract.inventoryItems) {
    try {
      await prisma.inventoryItem.upsert({
        where: { companyId_externalId: { companyId, externalId: item.externalId } },
        update: {
          name: item.name,
          currentStock: item.currentStock,
          salePrice: item.salePrice,
          purchasePrice: item.purchasePrice,
        },
        create: { companyId, ...item },
      });
      inventoryUpserted++;
    } catch (e) {
      warnings.push(`Inventory item ${item.externalId}: ${(e as Error).message}`);
    }
  }

  return { customersUpserted, invoicesUpserted, lineItemsUpserted, inventoryUpserted, warnings };
}

export async function runSync(): Promise<SyncSummary> {
  const env = getSyncEnv();
  const companyId = env.DEFAULT_COMPANY_ID;

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    throw new Error(`No company found for DEFAULT_COMPANY_ID=${companyId}. Run "npm run db:seed" first.`);
  }

  const syncRun = await prisma.syncRun.create({ data: { companyId } });

  try {
    const latest = await findLatestBackup(env.GOOGLE_SERVICE_ACCOUNT_JSON, env.GDRIVE_BACKUP_FOLDER_ID);
    if (!latest) {
      throw new Error("No .vyb backup found in the configured Google Drive folder");
    }

    const bytes = await downloadFile(env.GOOGLE_SERVICE_ACCOUNT_JSON, latest.id);
    const { vypPath, extractDir } = unpackVyb(bytes);

    try {
      const extract = readVyaparExtract(vypPath);
      const result = await persistExtract(companyId, extract, env.DEFAULT_PAYMENT_TERMS_DAYS);

      let brokerageReportsUpserted = 0;
      try {
        brokerageReportsUpserted = await syncDerivedBrokerage(companyId, extract, latest.name);
      } catch (e) {
        result.warnings.push(`Brokerage derivation: ${(e as Error).message}`);
      }

      await prisma.syncRun.update({
        where: { id: syncRun.id },
        data: {
          finishedAt: new Date(),
          status: "SUCCESS",
          sourceFileName: latest.name,
          customersUpserted: result.customersUpserted,
          invoicesUpserted: result.invoicesUpserted,
          lineItemsUpserted: result.lineItemsUpserted,
          inventoryUpserted: result.inventoryUpserted,
          errorMessage: result.warnings.length ? result.warnings.slice(0, 50).join("\n") : null,
        },
      });

      return { sourceFileName: latest.name, ...result, brokerageReportsUpserted };
    } finally {
      cleanupExtractDir(extractDir);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { finishedAt: new Date(), status: "FAILED", errorMessage: message },
    });
    throw err;
  }
}
