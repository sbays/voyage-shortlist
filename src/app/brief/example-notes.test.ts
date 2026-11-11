import { describe, expect, it } from "vitest";
import { MAX_NOTES_LENGTH } from "../../domain/limits.ts";
import { EXAMPLE_NOTES } from "./example-notes.ts";

describe("example notes", () => {
  it("offers a few distinct examples that fit the notes box", () => {
    expect(EXAMPLE_NOTES.length).toBeGreaterThanOrEqual(3);
    expect(EXAMPLE_NOTES.length).toBeLessThanOrEqual(5);
    expect(new Set(EXAMPLE_NOTES.map((e) => e.id)).size).toBe(EXAMPLE_NOTES.length);
    for (const example of EXAMPLE_NOTES) {
      expect(example.notes.length).toBeGreaterThan(0);
      expect(example.notes.length).toBeLessThanOrEqual(MAX_NOTES_LENGTH);
    }
  });

  it("uses no em dashes anywhere a visitor reads", () => {
    for (const { title, shows, notes } of EXAMPLE_NOTES) {
      expect(`${title} ${shows} ${notes}`).not.toMatch(/—/);
    }
  });

  // Vague dates are read against today, and the catalogue covers only the
  // 2026 to 2027 season, so each example names its year.
  it("gives every example an explicit year", () => {
    for (const { notes } of EXAMPLE_NOTES) {
      expect(notes).toMatch(/\b202[67]\b/);
    }
  });
});
