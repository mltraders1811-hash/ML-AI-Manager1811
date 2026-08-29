// Vyapar's internal SQLite schema is not officially documented. The
// candidates below were VERIFIED against a real Vyapar backup (Aug 2026) -
// see the comments on each field for what was actually confirmed vs. still
// a best-effort guess for transaction types Vyapar didn't have real
// examples of.
//
// If your data doesn't match, run `npm run inspect-vyp -- <path-to-file.vyb>`
// against a real backup - it prints every table's actual columns. The
// reader resolves each logical field against a list of candidates here
// (case-insensitive, exact match first, then substring) so small naming
// differences self-correct without a code change; only add a candidate
// here if the automatic match is wrong for your data.

export const TABLE_CANDIDATES = {
  customers: ["kb_names", "kb_name"],
  transactions: ["kb_transactions", "kb_transaction"],
  lineItems: ["kb_lineitems", "kb_line_items", "kb_transaction_items"],
  inventory: ["kb_items", "kb_item"],
  partyGroups: ["kb_party_groups", "kb_party_group"],
};

export const CUSTOMER_FIELD_CANDIDATES = {
  externalId: ["name_id", "id"],
  name: ["full_name", "name", "party_name"],
  phone: ["phone_number", "number", "phone", "mobile", "contact"],
  email: ["email_id", "email"],
  address: ["billing_address", "address"],
  // Verified: kb_names.name_group_id -> kb_party_groups.party_group_id.
  // Used to detect broker-assigned customers - see brokerRules.ts.
  groupId: ["name_group_id", "group_id"],
  // Verified: kb_names.amount is Vyapar's own maintained running balance
  // for this party - already correct, unlike any invoice-level balance
  // field (see the comment on Customer.currentBalance in schema.prisma).
  currentBalance: ["amount", "balance", "current_balance"],
};

export const PARTY_GROUP_FIELD_CANDIDATES = {
  id: ["party_group_id", "group_id", "id"],
  name: ["party_group_name", "group_name", "name"],
};

// Verified against a real backup: kb_transactions has NO direct "total
// amount" column - total is the sum of that transaction's own line items
// (see readTransactions in vyaparReader.ts). cashAmount is only used as a
// fallback for transactions with no line items (payments), where it
// genuinely does hold the payment amount.
export const TRANSACTION_FIELD_CANDIDATES = {
  externalId: ["txn_id", "transaction_id", "id"],
  customerExternalId: ["txn_name_id", "name_id", "party_id", "party_name_id"],
  typeCode: ["txn_type", "transaction_type", "type"],
  invoiceNumber: ["txn_ref_number_char", "txn_ref_number", "ref_number", "invoice_number", "bill_number"],
  invoiceDate: ["txn_date", "transaction_date", "date"],
  dueDate: ["txn_due_date", "due_date", "payment_due_date"],
  balanceAmount: ["txn_balance_amount", "balance_amount", "due_amount", "remaining_amount"],
  cashAmount: ["txn_cash_amount", "cash_amount"],
};

// Verified: kb_lineitems has no item-name column - it only has item_id, a
// foreign key into kb_items (joined separately in vyaparReader.ts).
export const LINE_ITEM_FIELD_CANDIDATES = {
  externalId: ["lineitem_id", "line_item_id", "item_line_id", "id"],
  invoiceExternalId: ["lineitem_txn_id", "txn_id", "transaction_id"],
  itemId: ["item_id"],
  quantity: ["quantity", "item_quantity", "qty"],
  unitPrice: ["priceperunit", "item_price", "price_per_unit", "unit_price", "price"],
  amount: ["total_amount", "item_amount", "amount", "total"],
};

export const INVENTORY_FIELD_CANDIDATES = {
  externalId: ["item_id", "id"],
  name: ["item_name", "name"],
  currentStock: ["item_stock_quantity", "current_stock", "stock_quantity", "opening_stock"],
  salePrice: ["item_sale_unit_price", "sale_unit_price", "sale_price", "selling_price"],
  purchasePrice: ["item_purchase_unit_price", "purchase_unit_price", "purchase_price", "cost_price"],
};

// Verified against a real backup for types 1-5 (2000+ real rows each for
// 1-3, confirmed via presence/absence of line items and cash movement
// direction). Type 5 is confirmed by Vyapar's own txn_description, which
// literally reads "Receivable opening balance" - one row per party, all
// dated the first day of the financial year. Type 6 is its supplier-side
// twin ("Payable opening balance"), which this app has no use for, and 65
// is a rare sale variant (2 rows) - both left as OTHER.
export const TXN_TYPE_MAP: Record<
  string,
  "SALE" | "SALE_RETURN" | "PURCHASE" | "PURCHASE_RETURN" | "PAYMENT_IN" | "PAYMENT_OUT" | "OPENING_BALANCE"
> = {
  "1": "SALE",
  sale: "SALE",
  "2": "PURCHASE",
  purchase: "PURCHASE",
  "3": "PAYMENT_IN",
  payment_in: "PAYMENT_IN",
  "4": "PAYMENT_OUT",
  payment_out: "PAYMENT_OUT",
  "5": "OPENING_BALANCE",
  opening_balance: "OPENING_BALANCE",
  "7": "SALE_RETURN",
  sale_return: "SALE_RETURN",
  "8": "PURCHASE_RETURN",
  purchase_return: "PURCHASE_RETURN",
};
