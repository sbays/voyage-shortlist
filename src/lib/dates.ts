const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const dayMonthYearTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** "2026-12-05" as "5 Dec 2026". Dates are calendar dates, so no time zone shift. */
export function formatDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new RangeError(`Not an ISO date: ${isoDate}`);
  }
  return dayMonthYear.format(new Date(`${isoDate}T00:00:00Z`));
}

/** An ISO timestamp as "1 Nov 2026, 09:00 UTC". */
export function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Not a timestamp: ${isoTimestamp}`);
  }
  return dayMonthYearTime.format(date);
}
