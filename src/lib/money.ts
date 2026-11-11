const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

/** Formats a whole-pound amount for display, e.g. 7900 → "£7,900". */
export function formatGbp(pounds: number): string {
  if (!Number.isInteger(pounds)) {
    throw new RangeError(`Expected whole pounds, got ${pounds}`);
  }
  return gbp.format(pounds);
}
