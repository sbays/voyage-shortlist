import type { BriefField } from "../action-types";
import type { DraftBrief, DraftField } from "@/domain/draft-brief";
import { MAX_NOTES_LENGTH } from "@/domain/limits";

// Pure helpers for the brief form: its starting values from the draft, and
// which form fields each "unclear" note from extraction belongs to.

/** Every field the form controls, as the text the inputs hold. */
export interface BriefFormValues {
  windowStart: string;
  windowEnd: string;
  budgetPerPersonGbp: string;
  partySize: string;
  soloPreference: DraftBrief["soloPreference"];
  mustHaveActivityIds: string[];
  partyDescription: string;
  softPreferences: string;
}

export function initialFormValues(draft: DraftBrief): BriefFormValues {
  return {
    windowStart: draft.windowStart ?? "",
    windowEnd: draft.windowEnd ?? "",
    budgetPerPersonGbp: draft.budgetPerPersonGbp === null ? "" : String(draft.budgetPerPersonGbp),
    partySize: draft.partySize === null ? "" : String(draft.partySize),
    soloPreference: draft.soloPreference,
    mustHaveActivityIds: [...draft.mustHaveActivityIds],
    partyDescription: draft.partyDescription,
    softPreferences: draft.softPreferences.join("\n"),
  };
}

const FIELDS_FOR: Record<DraftField, BriefField[]> = {
  window: ["windowStart", "windowEnd"],
  budget: ["budgetPerPersonGbp"],
  party_size: ["partySize"],
  solo_preference: ["soloPreference"],
  activities: ["mustHaveActivityIds"],
  preferences: ["softPreferences"],
};

/** The extraction's doubts, grouped by the form field each one should sit beside. */
export function unclearNotesByField(
  unclear: DraftBrief["unclear"],
): Partial<Record<BriefField, string[]>> {
  const notes: Partial<Record<BriefField, string[]>> = {};
  for (const { field, note } of unclear) {
    for (const formField of FIELDS_FOR[field]) {
      (notes[formField] ??= []).push(note);
    }
  }
  return notes;
}

/** The ids an input's aria-describedby should list, or undefined when there are none. */
export function describedBy(
  field: BriefField,
  has: { unclear: boolean; error: boolean; hint?: boolean },
): string | undefined {
  const ids = [
    has.hint ? `${field}-hint` : null,
    has.unclear ? `${field}-unclear` : null,
    has.error ? `${field}-error` : null,
  ].filter((id): id is string => id !== null);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** Whether an extraction error is about the notes themselves: empty or too long. */
export function isNotesProblem(notes: string): boolean {
  const trimmed = notes.trim();
  return trimmed.length === 0 || trimmed.length > MAX_NOTES_LENGTH;
}
