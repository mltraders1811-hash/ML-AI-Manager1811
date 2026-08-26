// Client-side fetch wrapper for /api/brokerage/*, mirroring khaata's
// frontend/src/api.ts pattern.
const BASE = "/api/brokerage";

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j.error || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export type BrokerSummary = {
  name: string;
  isShopOwn: boolean;
  totalQty: number;
  totalAmount: number;
  totalBrokerage: number;
  transactionCount: number;
};

export type Transaction = {
  date: string;
  dateIso: string | null;
  party: string;
  item: string;
  quantity: number;
  price: number;
  amount: number;
  brokerage: number;
};

export type BrokerDetail = BrokerSummary & { transactions: Transaction[] };

export type ReportSummary = {
  id: string;
  filename: string;
  fileSize: number;
  uploadedAt: string;
  month: string | null;
  summary: {
    totalTransactions: number;
    totalAmount: number;
    totalBrokerage: number;
    brokerCount: number;
    shopOwnCount: number;
  };
};

export type ReportDetail = ReportSummary & { brokers: BrokerSummary[] };

export type MonthlyComparison = {
  months: string[];
  brokers: {
    name: string;
    isShopOwn: boolean;
    monthly: Record<string, { amount: number; brokerage: number; txns: number }>;
    totalAmount: number;
    totalBrokerage: number;
    totalTxns: number;
  }[];
  monthTotals: { month: string; totalAmount: number; totalBrokerage: number; totalTransactions: number }[];
};

export type TopParty = { name: string; amount: number; qty: number; txns: number; lastDate: string | null };

export type InactiveParty = {
  name: string;
  previousAmount: number;
  currentAmount: number;
  dropAmount: number;
  dropPct: number;
  status: "missing" | "decreased";
  lastPurchase: string | null;
};

export type PaymentSummary = {
  reportId: string;
  month: string | null;
  brokers: {
    name: string;
    transactionCount: number;
    totalAmount: number;
    totalBrokerage: number;
    paid: number;
    balance: number;
    isSettled: boolean;
  }[];
  totals: { totalDue: number; totalPaid: number; balance: number };
};

export type Payment = {
  id: string;
  reportId: string;
  broker: string;
  amount: number;
  note: string;
  paidOn: string;
  createdAt: string;
};

export const brokerageApi = {
  listReports: () => request<{ reports: ReportSummary[] }>("/reports"),
  getReport: (id: string) => request<ReportDetail>(`/reports/${id}`),
  getBroker: (id: string, name: string) => request<BrokerDetail>(`/reports/${id}/broker/${encodeURIComponent(name)}`),
  exportBroker: (id: string, name: string, fmt: "text" | "excel" | "pdf") =>
    request<{ format: string; content?: string; base64?: string; filename: string; mime?: string }>(
      `/reports/${id}/broker/${encodeURIComponent(name)}/export?fmt=${fmt}`,
    ),
  deleteReport: (id: string) => request<{ success: boolean }>(`/reports/${id}`, { method: "DELETE" }),

  uploadFile: async (file: File): Promise<ReportSummary> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/reports/upload`, { method: "POST", body: form });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        detail = j.error || detail;
      } catch {}
      throw new Error(detail);
    }
    return res.json();
  },

  monthlyComparison: () => request<MonthlyComparison>("/analytics/monthly-comparison"),
  topParties: (month?: string, limit = 25) =>
    request<{ month: string | null; count: number; parties: TopParty[] }>(
      `/analytics/top-parties?limit=${limit}${month ? `&month=${month}` : ""}`,
    ),
  inactiveParties: (month?: string) =>
    request<{
      currentMonth: string | null;
      prevMonth: string | null;
      thresholdPct?: number;
      parties: InactiveParty[];
      count?: number;
      note?: string;
    }>(`/analytics/inactive-parties${month ? `?month=${month}` : ""}`),

  paymentSummary: (reportId: string) => request<PaymentSummary>(`/payments/report/${reportId}/summary`),
  listPayments: (reportId: string) => request<{ payments: Payment[] }>(`/payments/report/${reportId}`),
  addPayment: (data: { reportId: string; broker: string; amount: number; note?: string; paidOn?: string }) =>
    request<Payment>("/payments", { method: "POST", body: JSON.stringify(data) }),
  settleAll: (reportId: string, note?: string) =>
    request<{ count: number; payments: Payment[] }>(`/payments/report/${reportId}/settle-all`, {
      method: "POST",
      body: JSON.stringify({ note: note || undefined }),
    }),
  deletePayment: (id: string) => request<{ success: boolean }>(`/payments/${id}`, { method: "DELETE" }),
};
