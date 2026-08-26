export type BrokerageTransactionRow = {
  date: string; // as written, e.g. "05/08/2026"
  dateIso: string | null; // YYYY-MM-DD
  party: string;
  item: string;
  quantity: number;
  price: number;
  amount: number;
  brokerage: number;
};

export type BrokerGroup = {
  name: string;
  isShopOwn: boolean;
  transactions: BrokerageTransactionRow[];
  totalQty: number;
  totalAmount: number;
  totalBrokerage: number;
  transactionCount: number;
};

export type ParsedSaleReport = {
  month: string | null;
  summary: {
    totalTransactions: number;
    totalAmount: number;
    totalBrokerage: number;
    brokerCount: number;
    shopOwnCount: number;
  };
  brokers: BrokerGroup[];
};

export class ReportParseError extends Error {}
