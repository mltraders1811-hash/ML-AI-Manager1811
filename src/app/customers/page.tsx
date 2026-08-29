import { getEnv } from "@/lib/env";
import { getOverdueSettings } from "@/lib/overdue";

import { CustomersClient } from "./CustomersClient";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const { DEFAULT_COMPANY_ID } = getEnv();
  const { creditDays } = await getOverdueSettings(DEFAULT_COMPANY_ID);
  return <CustomersClient defaultCreditDays={creditDays} />;
}
