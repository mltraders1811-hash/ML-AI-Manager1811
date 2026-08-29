// Invoice/due dates are calendar dates with no timezone of their own (a
// sale on 20 Aug is 20 Aug regardless of what timezone a server runs in).
// We store them as UTC-midnight-of-that-calendar-date (see toDate() in
// vyaparReader.ts) and need "today"/"yesterday" expressed the same way -
// but the app runs on servers in UTC, while the business is in India, so
// "today" has to be computed as the IST calendar date, not the UTC one.
const IST_OFFSET_MINUTES = 330; // +05:30, no DST

/** The UTC instant representing midnight at the start of `date`'s IST calendar day. */
export function istStartOfDay(date: Date): Date {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MINUTES * 60_000);
}

/** The IST calendar date as YYYY-MM-DD. Note this is NOT
 * istStartOfDay().toISOString().slice(0,10): that instant is IST midnight
 * expressed in UTC, which for every day of the year reads as the *previous*
 * date. */
export function istDateString(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function getIstTodayRange(): { todayStart: Date; tomorrowStart: Date } {
  const todayStart = istStartOfDay(new Date());
  return { todayStart, tomorrowStart: addDays(todayStart, 1) };
}

export function getIstYesterdayRange(): { yesterdayStart: Date; todayStart: Date } {
  const { todayStart } = getIstTodayRange();
  return { yesterdayStart: addDays(todayStart, -1), todayStart };
}
