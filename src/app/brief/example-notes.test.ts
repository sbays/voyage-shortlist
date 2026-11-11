import { describe, expect, it } from "vitest";
import { MAX_NOTES_LENGTH } from "../../domain/limits.ts";
import { exampleNotes } from "./example-notes.ts";

describe("example notes", () => {
  it("offers a few distinct examples that fit the notes box", () => {
    const examples = exampleNotes(2026);
    expect(examples.length).toBeGreaterThanOrEqual(3);
    expect(examples.length).toBeLessThanOrEqual(5);
    expect(new Set(examples.map((e) => e.id)).size).toBe(examples.length);
    for (const example of examples) {
      expect(example.notes.length).toBeGreaterThan(0);
      expect(example.notes.length).toBeLessThanOrEqual(MAX_NOTES_LENGTH);
    }
  });

  it("uses no em dashes anywhere a visitor reads", () => {
    for (const { title, shows, notes } of exampleNotes(2026)) {
      expect(`${title} ${shows} ${notes}`).not.toMatch(/\u2014/);
    }
  });

  // Vague dates are read against today, so each example names the years of
  // the season in the database: November and December in the start year,
  // January to March in the next.
  it("names the season's years, and only those", () => {
    for (const { notes } of exampleNotes(2029)) {
      const years = notes.match(/\b20\d\d\b/g) ?? [];
      expect(years.length).toBeGreaterThan(0);
      expect(years.every((y) => y === "2029" || y === "2030")).toBe(true);
    }
    const byId = new Map(exampleNotes(2029).map((e) => [e.id, e.notes]));
    expect(byId.get("solo-own-cabin")).toContain("15 Dec 2029");
    expect(byId.get("kayak-couple")).toContain("February 2030");
    expect(byId.get("family-christmas")).toContain("Christmas 2029");
    expect(byId.get("family-christmas")).toContain("6 Jan 2030");
  });
});
