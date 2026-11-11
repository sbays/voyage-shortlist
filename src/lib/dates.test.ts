import { describe, expect, it } from "vitest";
import { formatDate, formatTimestamp } from "./dates";

describe("formatDate", () => {
  it("formats a calendar date without shifting it", () => {
    expect(formatDate("2026-12-05")).toBe("5 Dec 2026");
    expect(formatDate("2027-01-01")).toBe("1 Jan 2027");
  });

  it("rejects anything that isn't an ISO date", () => {
    expect(() => formatDate("05/12/2026")).toThrow(RangeError);
  });
});

describe("formatTimestamp", () => {
  it("formats in UTC", () => {
    expect(formatTimestamp("2026-11-01T09:00:00Z")).toBe("1 Nov 2026, 09:00 UTC");
  });

  it("rejects an invalid timestamp", () => {
    expect(() => formatTimestamp("yesterday")).toThrow(RangeError);
  });
});
