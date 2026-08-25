// Vyapar's internal SQLite schema is not officially documented, so the
// exact column names below are a best-effort guess based on the table
// names given in the product spec (kb_names / kb_transactions /
// kb_lineitems) and how Vyapar-style accounting apps typically name things.
//
// DO NOT trust these blindly. Run `npm run inspect-vyp -- <path-to-file.vyp>`
// against a real backup first - it prints every table's actual columns.
// vyaparReader.ts resolves each logical field against a list of candidates
// here (case-insensitive substring match) so a small naming difference
// (e.g. "name_id" vs "id") self-corrects without a code change; only add a
// candidate here if the automatic match is wrong for your data.

export const TABLE_CANDIDATES = {
  customers: ["kb_names", "kb_name"],
  transactions: ["kb_transactions", "kb_transaction"],
  lineItems: ["kb_lineitems", "kb_line_items", "kb_transaction_items"],
  inventory: ["kb_item", "kb_items"],
};

export const CUSTOMER_FIELD_CANDIDATES = {
  externalId: ["name_id", "id"],
  name: ["full_name", "name", "party_name"],
  phone: ["number", "phone", "mobile", "contact"],
  email: ["email_id", "email"],
  address: ["billing_address", "address"],
};

export const TRANSACTION_FIELD_CANDIDATES = {
  externalId: ["txn_id", "transaction_id", "id"],
  customerExternalId: ["name_id", "party_id", "party_name_id"],
  typeCode: ["txn_type", "transaction_type", "type"],
  invoiceNumber: ["txn_ref_number", "ref_number", "invoice_number", "bill_number"],
  invoiceDate: ["txn_date", "transaction_date", "date"],
  dueDate: ["due_date", "payment_due_date"],
  totalAmount: ["total_amount", "txn_amount", "amount"],
  balanceAmount: ["balance_amount", "due_amount", "remaining_amount"],
};

export const LINE_ITEM_FIELD_CANDIDATES = {
  externalId: ["line_item_id", "item_line_id", "id"],
  invoiceExternalId: ["txn_id", "transaction_id"],
  itemName: ["item_name", "name"],
  quantity: ["item_quantity", "quantity", "qty"],
  unitPrice: ["item_price", "price_per_unit", "unit_price", "price"],
  amount: ["item_amount", "amount", "total"],
};

export const INVENTORY_FIELD_CANDIDATES = {
  externalId: ["item_id", "id"],
  name: ["item_name", "name"],
  currentStock: ["current_stock", "stock_quantity", "opening_stock"],
  salePrice: ["sale_price", "selling_price"],
  purchasePrice: ["purchase_price", "cost_price"],
};

// Vyapar's txn_type is typically a small integer or short code. This maps
// the *common* convention seen across Vyapar-style apps to our enum;
// anything unrecognized falls back to "OTHER" rather than guessing wrong.
// VERIFY against `select distinct txn_type from kb_transactions` on a real
// backup and adjust.
export const TXN_TYPE_MAP: Record<string, "SALE" | "SALE_RETURN" | "PURCHASE" | "PURCHASE_RETURN" | "PAYMENT_IN" | "PAYMENT_OUT"> = {
  "1": "SALE",
  sale: "SALE",
  "2": "PURCHASE",
  purchase: "PURCHASE",
  "3": "PAYMENT_IN",
  payment_in: "PAYMENT_IN",
  "4": "PAYMENT_OUT",
  payment_out: "PAYMENT_OUT",
  "7": "SALE_RETURN",
  sale_return: "SALE_RETURN",
  "8": "PURCHASE_RETURN",
  purchase_return: "PURCHASE_RETURN",
};
