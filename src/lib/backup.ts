import { prisma } from "@/lib/prisma";

// Most of this database is disposable: customers, invoices, line items and
// inventory are rebuilt from the Vyapar backup on every sync, so losing them
// costs a sync run. These tables are not - they hold work the owner did by
// hand, which exists nowhere else:
//
//   * brokerage payments recorded against brokers
//   * reports built from a manually uploaded Sale Report
//   * phone numbers, notes and credit terms typed into the phone book
//     (Vyapar has no number for most parties - see the phone book screen)
//   * the reminder wording and invoice design settings
//
// Customers are keyed by their Vyapar id (externalId) rather than our own
// uuid, so a restore can re-attach them after a fresh sync recreates the rows.

export const BACKUP_FORMAT_VERSION = 1;

export type BackupFile = {
  formatVersion: number;
  exportedAt: string;
  companyId: string;
  counts: Record<string, number>;
  customerEdits: {
    externalId: string;
    name: string;
    phone: string | null;
    note: string | null;
    creditDays: number | null;
  }[];
  overdueSettings: { creditDays: number; reminderTemplate: string } | null;
  invoiceDesignSettings: Record<string, unknown> | null;
  brokerageReports: unknown[];
  brokeragePayments: unknown[];
};

export async function buildBackup(companyId: string): Promise<BackupFile> {
  const [customers, overdueSettings, invoiceDesign, reports, payments] = await Promise.all([
    prisma.customer.findMany({
      where: {
        companyId,
        // Only rows carrying hand-entered data are worth keeping; the rest
        // come back verbatim on the next sync.
        OR: [{ phone: { not: null } }, { note: { not: null } }, { creditDays: { not: null } }],
      },
      select: { externalId: true, name: true, phone: true, note: true, creditDays: true },
      orderBy: { name: "asc" },
    }),
    prisma.overdueSettings.findUnique({ where: { companyId } }),
    prisma.invoiceDesignSettings.findUnique({ where: { companyId } }),
    prisma.brokerageReport.findMany({
      where: { companyId },
      include: { brokers: { include: { transactions: true } } },
      orderBy: { uploadedAt: "asc" },
    }),
    prisma.brokeragePayment.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
  ]);

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    companyId,
    counts: {
      customerEdits: customers.length,
      brokerageReports: reports.length,
      brokeragePayments: payments.length,
    },
    customerEdits: customers,
    overdueSettings: overdueSettings
      ? { creditDays: overdueSettings.creditDays, reminderTemplate: overdueSettings.reminderTemplate }
      : null,
    invoiceDesignSettings: invoiceDesign
      ? {
          businessName: invoiceDesign.businessName,
          addressLine: invoiceDesign.addressLine,
          phone: invoiceDesign.phone,
          gstin: invoiceDesign.gstin,
          accentColor: invoiceDesign.accentColor,
          footerNote: invoiceDesign.footerNote,
          showLineItems: invoiceDesign.showLineItems,
        }
      : null,
    // Decimal and Date values are serialised by the JSON.stringify below in
    // the API route / script; Prisma's Decimal has a toJSON that emits a
    // string, which round-trips exactly (no float precision loss).
    brokerageReports: reports,
    brokeragePayments: payments,
  };
}
