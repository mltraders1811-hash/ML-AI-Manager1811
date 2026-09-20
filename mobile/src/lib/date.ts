/** Dates are stored as yyyy-mm-dd strings: they sort as text, compare as
 *  text, and never shift by a timezone on the way into SQLite. */

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** yyyy-mm-dd -> dd/mm/yyyy, the way a bill is read here. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function formatDateLong(iso: string): string {
  const parsed = parseISODate(iso);
  if (!parsed) return iso;
  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Accepts dd/mm/yyyy or dd-mm-yyyy as well, since that is what gets typed. */
export function parseFlexibleDate(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parseISODate(trimmed) ? trimmed : null;
  }
  const m = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return parseISODate(iso) ? iso : null;
}

function parseISODate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  // Rejects 2026-02-31, which Date would happily roll into March.
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    return null;
  }
  return date;
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** First and last day of the month a date falls in, both inclusive. */
export function monthRange(iso: string): { from: string; to: string } {
  const d = parseISODate(iso) ?? new Date();
  const from = toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  const to = toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return { from, to };
}

export function monthLabel(iso: string): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/** "Today" / "Yesterday" / a date - what a list of orders should say. */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const today = toISODate(now);
  if (iso === today) return "Today";
  if (iso === addDays(today, -1)) return "Yesterday";
  return formatDate(iso);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISO);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
