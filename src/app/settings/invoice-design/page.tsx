import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

import { InvoiceDesignClient } from "./InvoiceDesignClient";

export const dynamic = "force-dynamic";

export default async function InvoiceDesignPage() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  // Preview against a real recent invoice rather than dummy data, so the
  // owner sees exactly what a customer would get.
  const sample = await prisma.invoice.findFirst({
    where: { companyId: DEFAULT_COMPANY_ID, type: "SALE" },
    orderBy: { invoiceDate: "desc" },
    select: { id: true },
  });
  return <InvoiceDesignClient sampleInvoiceId={sample?.id ?? null} />;
}
