import { BankClient } from "./BankClient";

export const dynamic = "force-dynamic"; // money that landed today, never a cached copy

export default function BankPage() {
  return <BankClient />;
}
