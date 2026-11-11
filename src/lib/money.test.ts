import { describe, expect, it } from "vitest";
import { formatGbp } from "@/lib/money";

describe("formatGbp", () => {
  it("formats whole pounds with a thousands separator", () => {
    expect(formatGbp(7900)).toBe("£7,900");
    expect(formatGbp(14250)).toBe("£14,250");
  });

  it("formats zero", () => {
    expect(formatGbp(0)).toBe("£0");
  });

  it("rejects fractional amounts so pence never sneak into a quote", () => {
    expect(() => formatGbp(7900.5)).toThrow(RangeError);
  });
});
