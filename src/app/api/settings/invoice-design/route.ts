import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { DEFAULT_INVOICE_DESIGN, getInvoiceDesign, safeHexColor } from "@/lib/invoicePdf";

export async function GET() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const design = await getInvoiceDesign(DEFAULT_COMPANY_ID);
  return NextResponse.json({ ...design, defaults: DEFAULT_INVOICE_DESIGN });
}

const bodySchema = z.object({
  businessName: z.string().min(1).max(120),
  addressLine: z.string().max(200).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  gstin: z.string().max(40).nullable().optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "accentColor must be a hex colour like #2B5336"),
  footerNote: z.string().max(500).nullable().optional(),
  showLineItems: z.boolean(),
});

export async function PUT(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid invoice design settings" },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const data = {
    businessName: d.businessName.trim(),
    addressLine: d.addressLine?.trim() || null,
    phone: d.phone?.trim() || null,
    gstin: d.gstin?.trim() || null,
    accentColor: safeHexColor(d.accentColor, DEFAULT_INVOICE_DESIGN.accentColor),
    footerNote: d.footerNote?.trim() || null,
    showLineItems: d.showLineItems,
  };

  await prisma.invoiceDesignSettings.upsert({
    where: { companyId: DEFAULT_COMPANY_ID },
    update: data,
    create: { companyId: DEFAULT_COMPANY_ID, ...data },
  });

  return NextResponse.json({ ok: true, ...data });
}
