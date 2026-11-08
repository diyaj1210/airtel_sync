/**
 * "Today" for every date-based rule (data/raw/README.md: use 2026-07-15).
 * Business logic takes the date as a parameter; it never reads the system clock.
 */
export const TODAY = "2026-07-15";

/** Add whole days to an ISO date (YYYY-MM-DD), in UTC, returning an ISO date. */
export function addDays(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`Expected YYYY-MM-DD, got "${isoDate}"`);
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== isoDate) {
    throw new Error(`Invalid date "${isoDate}"`);
  }
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
