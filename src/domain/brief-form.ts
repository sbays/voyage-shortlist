import { Brief } from "./brief.ts";
import { MAX_NOTES_LENGTH } from "./limits.ts";

// Turns the posted brief form into a checked Brief. The form is untrusted
// input: every field is read as text and validated here, never trusted from
// the client's own checks. Field names match BRIEF_FIELDS in
// src/app/action-types.ts.

export type BriefFormField =
  | "rawNotes"
  | "windowStart"
  | "windowEnd"
  | "budgetPerPersonGbp"
  | "partySize"
  | "soloPreference"
  | "mustHaveActivityIds"
  | "partyDescription"
  | "softPreferences";

/** The part of FormData this reads, so tests can pass a plain FormData. */
export interface FormValues {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

export type ParsedBriefForm =
  | { ok: true; rawNotes: string; brief: Brief }
  | {
      ok: false;
      fieldErrors: Partial<Record<BriefFormField, string>>;
      /** A problem that isn't one field's, shown above the form instead. */
      message?: string;
    };

const MAX_PREFERENCES = 20;
const MAX_TEXT = 500;

const text = (form: FormValues, name: BriefFormField) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** "£12,500" or "12500" → 12500; anything else → NaN. */
function wholeNumber(raw: string): number {
  const cleaned = raw.replace(/[£,\s]/g, "");
  return /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

const FIELD_MESSAGES: Partial<Record<BriefFormField, string>> = {
  windowStart: "Enter the first day they could travel.",
  windowEnd: "Enter the last day they could travel, on or after the first.",
  budgetPerPersonGbp: "Enter a budget per person in whole pounds.",
  partySize: "Enter how many people are travelling.",
  soloPreference: "Choose a cabin preference.",
  mustHaveActivityIds: "Choose activities from the list.",
};

const hasMessage = (field: string): field is BriefFormField => field in FIELD_MESSAGES;

export function parseBriefForm(form: FormValues, activityIds: readonly string[]): ParsedBriefForm {
  const fieldErrors: Partial<Record<BriefFormField, string>> = {};

  const activities = form
    .getAll("mustHaveActivityIds")
    .filter((v): v is string => typeof v === "string");
  if (activities.some((id) => !activityIds.includes(id))) {
    fieldErrors.mustHaveActivityIds = FIELD_MESSAGES.mustHaveActivityIds;
  }

  // The notes arrive in a hidden field, so the length the notes box allows
  // has to be enforced again before they are stored. There's no field to
  // mark, so it's a form-level message.
  if (text(form, "rawNotes").length > MAX_NOTES_LENGTH) {
    return {
      ok: false,
      fieldErrors: {},
      message: `Notes can be up to ${MAX_NOTES_LENGTH.toLocaleString("en-GB")} characters. Shorten them and read them again.`,
    };
  }

  const partyDescription = text(form, "partyDescription");
  if (partyDescription.length > MAX_TEXT) {
    fieldErrors.partyDescription = `Keep the party description under ${MAX_TEXT} characters.`;
  }
  const softPreferences = text(form, "softPreferences")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (softPreferences.length > MAX_PREFERENCES || softPreferences.some((p) => p.length > MAX_TEXT)) {
    fieldErrors.softPreferences = `Use up to ${MAX_PREFERENCES} short preferences, one per line.`;
  }

  const parsed = Brief.safeParse({
    rules: {
      windowStart: text(form, "windowStart"),
      windowEnd: text(form, "windowEnd"),
      budgetPerPersonGbp: wholeNumber(text(form, "budgetPerPersonGbp")),
      partySize: wholeNumber(text(form, "partySize")),
      soloPreference: text(form, "soloPreference") || "either",
      mustHaveActivityIds: activities,
    },
    partyDescription,
    softPreferences,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.at(-1);
      if (typeof field === "string" && hasMessage(field)) {
        fieldErrors[field] ??= FIELD_MESSAGES[field];
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  if (!parsed.success) {
    // A schema issue on a field with no message still has to stop the run.
    return { ok: false, fieldErrors, message: "Check the brief and try again." };
  }
  return { ok: true, rawNotes: text(form, "rawNotes"), brief: parsed.data };
}
