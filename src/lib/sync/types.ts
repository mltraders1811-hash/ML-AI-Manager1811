// Normalized shape the sync engine writes to Postgres, decoupled from
// whatever Vyapar's actual SQLite column names turn out to be - only
// columnMap.ts needs to change if reality differs from our best guess.

export type NormalizedCustomer = {
  externalId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
};

export type NormalizedInvoiceType =
  | "SALE"
  | "SALE_RETURN"
  | "PURCHASE"
  | "PURCHASE_RETURN"
  | "PAYMENT_IN"
  | "PAYMENT_OUT"
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
