import { describe, expect, it } from "vitest";
import { parseBriefForm } from "./brief-form.ts";

const ACTIVITIES = ["act_kayak", "act_camp"];

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(name, v);
  }
  return data;
}

const valid = {
  rawNotes: "  notes  ",
  windowStart: "2026-12-01",
  windowEnd: "2026-12-31",
  budgetPerPersonGbp: "£12,500",
  partySize: "2",
  soloPreference: "either",
  mustHaveActivityIds: ["act_kayak", "act_kayak"],
  partyDescription: "couple",
  softPreferences: "small ship\n\n  worried about seasickness  \n",
};

describe("parseBriefForm", () => {
  it("parses a valid form, cleaning money and preference lines", () => {
    const parsed = parseBriefForm(form(valid), ACTIVITIES);

    expect(parsed).toEqual({
      ok: true,
      rawNotes: "notes",
      brief: {
        rules: {
          windowStart: "2026-12-01",
          windowEnd: "2026-12-31",
          budgetPerPersonGbp: 12_500,
          partySize: 2,
          soloPreference: "either",
          mustHaveActivityIds: ["act_kayak"],
        },
        partyDescription: "couple",
        softPreferences: ["small ship", "worried about seasickness"],
      },
    });
  });

  it("names each bad field", () => {
    const parsed = parseBriefForm(
      form({ ...valid, windowStart: "", budgetPerPersonGbp: "12.5k", partySize: "0" }),
      ACTIVITIES,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.fieldErrors).sort()).toEqual([
      "budgetPerPersonGbp",
      "partySize",
      "windowStart",
    ]);
  });

  it("rejects a window that ends before it starts", () => {
    const parsed = parseBriefForm(form({ ...valid, windowEnd: "2026-11-01" }), ACTIVITIES);
    expect(parsed).toMatchObject({ ok: false, fieldErrors: { windowEnd: expect.any(String) } });
  });

  it("rejects an activity that isn't in the catalogue", () => {
    const parsed = parseBriefForm(form({ ...valid, mustHaveActivityIds: ["act_jetski"] }), ACTIVITIES);
    expect(parsed).toMatchObject({ ok: false, fieldErrors: { mustHaveActivityIds: expect.any(String) } });
  });

  it("rejects an unknown cabin preference", () => {
    const parsed = parseBriefForm(form({ ...valid, soloPreference: "penthouse" }), ACTIVITIES);
    expect(parsed).toMatchObject({ ok: false, fieldErrors: { soloPreference: expect.any(String) } });
  });

  it("rejects notes longer than the notes box allows", () => {
    const parsed = parseBriefForm(form({ ...valid, rawNotes: "x".repeat(5_001) }), ACTIVITIES);
    expect(parsed).toMatchObject({ ok: false, fieldErrors: {}, message: expect.stringContaining("5,000") });
  });

  it("defaults a missing cabin preference to either", () => {
    const data = form(valid);
    data.delete("soloPreference");
    const parsed = parseBriefForm(data, ACTIVITIES);
    expect(parsed.ok && parsed.brief.rules.soloPreference).toBe("either");
  });
});
