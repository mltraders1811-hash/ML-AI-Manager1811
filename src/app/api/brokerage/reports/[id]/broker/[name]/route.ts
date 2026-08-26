import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/apiError";
import { getBrokerDetail } from "@/lib/brokerage/reportService";
import { getEnv } from "@/lib/env";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  const { DEFAULT_COMPANY_ID } = getEnv();
  try {
    const { broker } = await getBrokerDetail(DEFAULT_COMPANY_ID, id, decodeURIComponent(name));
    return NextResponse.json({
      name: broker.name,
      isShopOwn: broker.isShopOwn,
      totalQty: broker.totalQty.toNumber(),
      totalAmount: broker.totalAmount.toNumber(),
      totalBrokerage: broker.totalBrokerage.toNumber(),
      transactionCount: broker.transactionCount,
      transactions: broker.transactions.map((t) => ({
        date: t.date,
        dateIso: t.dateIso,
        party: t.party,
        item: t.item,
        quantity: t.quantity.toNumber(),
        price: t.price.toNumber(),
        amount: t.amount.toNumber(),
        brokerage: t.brokerage.toNumber(),
      })),
    });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
