/** Money maths. Every amount in the app passes through here so a bill never
 *  shows 28308.199999999997. */

/** Rounds to paise. Amounts are stored rounded so totals always re-add. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Parses what someone typed into a number field. Accepts "1,250.5", "₹300",
 *  a blank field, and rejects the rest rather than producing NaN. */
export function parseAmount(input: string | number | null | undefined): number {
  if (typeof input === "number") return Number.isFinite(input) ? input : 0;
  if (!input) return 0;
  const cleaned = String(input).replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** ₹1,23,456.50 - Indian digit grouping, which Intl gets right and a naive
 *  thousands-separator does not. */
export function formatINR(n: number, opts: { decimals?: boolean } = {}): string {
  const value = round2(n);
  const decimals = opts.decimals ?? !Number.isInteger(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(value);
}

/** The same grouping without the symbol, for tight columns. */
export function formatNumber(n: number, maxDecimals = 2): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: maxDecimals,
  }).format(round2(n));
}

/** "2 bags · 59.8 kg" style quantities: trailing zeros help nobody. */
export function formatQty(n: number): string {
  return formatNumber(n, 3);
}
