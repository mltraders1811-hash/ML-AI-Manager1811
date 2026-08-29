// Normalized shape the sync engine writes to Postgres, decoupled from
// whatever Vyapar's actual SQLite column names turn out to be - only
// columnMap.ts needs to change if reality differs from our best guess.

export type NormalizedCustomer = {
  externalId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  // The Vyapar party group this customer belongs to (kb_party_groups),
  // e.g. "Tota Brokar" - some shops use this to track which broker
  // introduced/handles a customer. Null if ungrouped or the group table
  // isn't present. See src/lib/sync/brokerageFromVyapar.ts.
  partyGroupName: string | null;
  // kb_names.amount - Vyapar's own running balance for this party. Trusted
  // as-is; see the comment on Customer.currentBalance in schema.prisma for
  // why invoice-level balances can't be used instead.
  currentBalance: number;
};

export type NormalizedInvoiceType =
  | "SALE"
  | "SALE_RETURN"
  | "PURCHASE"
  | "PURCHASE_RETURN"
  | "PAYMENT_IN"
  | "PAYMENT_OUT"
  | "OPENING_BALANCE"
  | "OTHER";

export type NormalizedInvoice = {
  externalId: string;
  customerExternalId: string;
  type: NormalizedInvoiceType;
  invoiceNumber: string | null;
  invoiceDate: Date;
  dueDate: Date | null;
  totalAmount: number;
  paidAmount: number;
};

export type NormalizedLineItem = {
  externalId: string;
  invoiceExternalId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type NormalizedInventoryItem = {
  externalId: string;
  name: string;
  currentStock: number | null;
  salePrice: number | null;
  purchasePrice: number | null;
};

export type VyaparExtract = {
  customers: NormalizedCustomer[];
  invoices: NormalizedInvoice[];
  lineItems: NormalizedLineItem[];
  inventoryItems: NormalizedInventoryItem[];
};
