/** Indian comma grouping (lakhs/crores), e.g. 1234567 -> "12,34,567". */
export function formatInr(amount: number): string {
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const intPart = Math.floor(abs);
  const decPart = Math.round((abs - intPart) * 100);
  const s = String(intPart);
  let grouped: string;
  if (s.length <= 3) {
    grouped = s;
  } else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d\d)+(?!\d))/g, ",");
    grouped = `${rest},${last3}`;
  }
  const decStr = decPart > 0 ? `.${String(decPart).padStart(2, "0")}` : "";
  return (neg ? "-" : "") + grouped + decStr;
}

export function formatDateDDMMYYYY(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}
