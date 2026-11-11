import { describe, expect, it } from "vitest";
import { addYears, seasonOffsetYears, seasonStartYear } from "./season.ts";

describe("season", () => {
  it("shows the coming season from April and the one in progress until March", () => {
    expect(seasonStartYear(new Date("2026-11-11T00:00:00Z"))).toBe(2026);
    expect(seasonStartYear(new Date("2027-03-31T23:00:00Z"))).toBe(2026);
    expect(seasonStartYear(new Date("2027-04-01T00:00:00Z"))).toBe(2027);
  });

  it("never shifts the catalogue backwards", () => {
    expect(seasonOffsetYears(new Date("2025-06-01T00:00:00Z"))).toBe(0);
    expect(seasonOffsetYears(new Date("2029-12-01T00:00:00Z"))).toBe(3);
  });

  it("adds years, turning 29 February into 28 February", () => {
    expect(addYears("2026-12-25", 2)).toBe("2028-12-25");
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2027-02-28", 1)).toBe("2028-02-28");
  });
});
