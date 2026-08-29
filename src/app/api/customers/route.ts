import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

/** The customer phone book. Customers themselves come from the Vyapar sync -
 * this lists them with the locally-editable fields (phone, note, credit
 * days) so the owner can fill in what Vyapar doesn't have. */
export async function GET(req: NextRequest) {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const missingPhone = req.nextUrl.searchParams.get("missingPhone") === "1";

  const customers = await prisma.customer.findMany({
    where: {
      companyId: DEFAULT_COMPANY_ID,
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      ...(missingPhone ? { OR: [{ phone: null }, { phone: "" }] } : {}),
    },
    orderBy: [{ currentBalance: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      phone: true,
      note: true,
      creditDays: true,
      currentBalance: true,
    },
    take: 500,
  });

  return NextResponse.json({
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      note: c.note,
      creditDays: c.creditDays,
      balance: c.currentBalance.toNumber(),
    })),
  });
}
