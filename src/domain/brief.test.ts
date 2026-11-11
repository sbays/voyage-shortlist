import { describe, expect, it } from "vitest";
import { HardRules } from "./brief.ts";

const base = {
  windowStart: "2026-12-01",
  windowEnd: "2026-12-31",
  budgetPerPersonGbp: 10_000,
  partySize: 2,
};

describe("HardRules", () => {
  it("defaults to either and no must-have activities", () => {
    expect(HardRules.parse(base)).toMatchObject({ soloPreference: "either", mustHaveActivityIds: [] });
  });

  it("removes repeated must-have activities", () => {
    const rules = HardRules.parse({ ...base, mustHaveActivityIds: ["act_kayak", "act_kayak", "act_camp"] });

    expect(rules.mustHaveActivityIds).toEqual(["act_kayak", "act_camp"]);
  });

  it("rejects a window that ends before it starts", () => {
    expect(HardRules.safeParse({ ...base, windowEnd: "2026-11-30" }).success).toBe(false);
  });

  it("rejects a fractional budget", () => {
    expect(HardRules.safeParse({ ...base, budgetPerPersonGbp: 9_999.5 }).success).toBe(false);
  });
});
