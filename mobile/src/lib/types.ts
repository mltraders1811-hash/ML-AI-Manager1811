// The shapes every layer agrees on. Deliberately free of any react-native
// import so the order maths can be unit-tested on a laptop.

export type OrderStatus = "pending" | "packed" | "delivered" | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "packed",
  "delivered",
  "cancelled",
];

/** Derived from money received against the bill - never stored. */
export type PaymentStatus = "unpaid" | "partial" | "paid";

export interface Party {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Item {
  id: string;
  name: string;
  unit: string;
  /** Rate per unit the form starts from; every line can still override it. */
  defaultRate: number;
  /** Bags are how stock is counted, kilos are what is billed. */
  kgPerBag: number;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export interface Broker {
  id: string;
  name: string;
  /** Percent of the line amount. 0 means "no brokerage on this one". */
  commissionPct: number;
}

export interface OrderLine {
  id: string;
  orderId: string;
  itemId: string | null;
  /** Copied from the item, not joined: renaming an item must not rewrite history. */
  itemName: string;
  bags: number | null;
  qty: number;
  rate: number;
  amount: number;
  position: number;
}

export interface Order {
  id: string;
  orderNo: string;
  partyId: string;
  /** Snapshotted for the same reason as itemName. */
  partyName: string;
  brokerId: string | null;
  brokerName: string | null;
  date: string; // yyyy-mm-dd
  status: OrderStatus;
  note: string | null;
  /** Who is carrying it, noted with the order so the challan needs no form. */
  transporterId: string | null;
  transporterName: string | null;
  /** The gadi number painted on the lorry - what the gateman checks. */
  vehicleNo: string | null;
  subtotal: number;
  discount: number;
  total: number;
  received: number;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderWithLines extends Order {
  lines: OrderLine[];
}

/** What the form holds while it is being filled in - strings, because a
 *  half-typed "12." is not a number yet. */
export interface DraftLine {
  key: string;
  itemId: string | null;
  itemName: string;
  bags: string;
  qty: string;
  rate: string;
}

export interface Transporter {
  id: string;
  name: string;
  phone: string | null;
}

/** The delivery note that travels with the goods. One per order: a bill is
 *  for the party's accounts, a challan is for the driver and the gateman. */
export interface Challan {
  id: string;
  challanNo: string;
  orderId: string;
  date: string; // yyyy-mm-dd
  transporterId: string | null;
  transporterName: string | null;
  transporterPhone: string | null;
  /** The gadi number painted on the lorry - what the gateman checks. */
  vehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  /** The transporter's own builty / lorry receipt number. */
  lrNo: string | null;
  destination: string | null;
  note: string | null;
  showRates: boolean;
  // Everything above is copied from the order when the challan is issued;
  // none of it is typed twice.
  createdAt: string;
  updatedAt: string;
}

/** Who the goods are going out from - printed at the top of a challan. */
export interface ShopProfile {
  name: string;
  address: string;
  phone: string;
  gstin: string;
}
