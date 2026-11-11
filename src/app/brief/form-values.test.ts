import { describe, expect, it } from "vitest";
import type { DraftBrief } from "@/domain/draft-brief";
import { MAX_NOTES_LENGTH } from "@/domain/limits";
import { describedBy, initialFormValues, isNotesProblem, unclearNotesByField } from "./form-values";

const draft: DraftBrief = {
  windowStart: "2026-12-18",
  windowEnd: null,
  budgetPerPersonGbp: 12_000,
  budgetConversion: "£24,000 total ÷ 2 people",
  partySize: null,
  partyDescription: "couple",
  soloPreference: "either",
  mustHaveActivityIds: ["act_kayak"],
  softPreferences: ["small ship", "penguin chicks"],
  unclear: [
    { field: "window", note: "Read 'over Christmas' as 18 Dec." },
    { field: "party_size", note: "Party size not given." },
    { field: "window", note: "End date guessed." },
  ],
};

describe("initialFormValues", () => {
  it("starts null fields empty and joins preferences one per line", () => {
    expect(initialFormValues(draft)).toEqual({
      windowStart: "2026-12-18",
      windowEnd: "",
      budgetPerPersonGbp: "12000",
      partySize: "",
      soloPreference: "either",
      mustHaveActivityIds: ["act_kayak"],
      partyDescription: "couple",
      softPreferences: "small ship\npenguin chicks",
    });
  });

  it("copies the activity list so editing it can't change the draft", () => {
    const values = initialFormValues(draft);
    values.mustHaveActivityIds.push("act_camp");
    expect(draft.mustHaveActivityIds).toEqual(["act_kayak"]);
  });
});

describe("unclearNotesByField", () => {
  it("puts window notes beside both dates, in order", () => {
    const notes = unclearNotesByField(draft.unclear);
    expect(notes).toEqual({
      windowStart: ["Read 'over Christmas' as 18 Dec.", "End date guessed."],
      windowEnd: ["Read 'over Christmas' as 18 Dec.", "End date guessed."],
      partySize: ["Party size not given."],
    });
  });

  it("maps every draft field to a form field", () => {
    const notes = unclearNotesByField([
      { field: "budget", note: "a" },
      { field: "solo_preference", note: "b" },
      { field: "activities", note: "c" },
      { field: "preferences", note: "d" },
    ]);
    expect(Object.keys(notes).sort()).toEqual([
      "budgetPerPersonGbp",
      "mustHaveActivityIds",
      "softPreferences",
      "soloPreference",
    ]);
  });
});

describe("describedBy", () => {
  it("lists hint, unclear and error ids, or nothing", () => {
    expect(describedBy("partySize", { unclear: false, error: false })).toBeUndefined();
    expect(describedBy("partySize", { unclear: true, error: true, hint: true })).toBe(
      "partySize-hint partySize-unclear partySize-error",
    );
  });
});

describe("isNotesProblem", () => {
  it("is true only for empty or over-long notes", () => {
    expect(isNotesProblem("   ")).toBe(true);
    expect(isNotesProblem("x".repeat(MAX_NOTES_LENGTH + 1))).toBe(true);
    expect(isNotesProblem("Couple, mid Jan, 12k each")).toBe(false);
    expect(isNotesProblem("x".repeat(MAX_NOTES_LENGTH))).toBe(false);
  });
});
