// Which November to March season the demo shows. The seed catalogue is built
// for the 2026 to 2027 season and shifted forward by whole years to the
// current one (DECISIONS.md, "the demo's season rolls forward").

/** The year the generated catalogue's season starts in. */
export const BASE_SEASON_YEAR = 2026;

/**
 * The year the demo's season starts in, on a given day. From April the
 * coming season (November this year); from January to March the season in
 * progress, which started last November.
 */
export function seasonStartYear(today: Date): number {
  const year = today.getUTCFullYear();
  return today.getUTCMonth() < 3 ? year - 1 : year;
}

/** Whole years to shift the generated catalogue by on a given day. */
export function seasonOffsetYears(today: Date): number {
  return Math.max(0, seasonStartYear(today) - BASE_SEASON_YEAR);
}

/** An ISO date moved by whole years. 29 February becomes 28 February. */
export function addYears(isoDate: string, years: number): string {
  if (years === 0) return isoDate;
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = y + years;
  const lastDay = new Date(Date.UTC(target, m, 0)).getUTCDate();
  return `${target}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}
