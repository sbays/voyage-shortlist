import { z } from "zod";

// What "Extract the brief" returns. It is a structured-outputs schema, so it
// stays within those limits: every field required (null when the notes don't
// say), no numeric ranges and no string lengths. Range checks happen when the
// draft is turned into a form (src/claude/extract.ts), never in the schema.

export const DraftField = z.enum([
  "window",
  "budget",
  "party_size",
  "solo_preference",
  "activities",
  "preferences",
]);
export type DraftField = z.infer<typeof DraftField>;

export const ExtractionOutput = z.object({
  /** ISO dates, or null when the notes give no dates. */
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  budgetAmountGbp: z.number().nullable(),
  /** Whether the amount is per person or for the whole party. */
  budgetBasis: z.enum(["per_person", "total", "unknown"]),
  partySize: z.number().nullable(),
  partyDescription: z.string(),
  soloPreference: z.enum(["own_cabin", "will_share", "either"]),
  /** Activity IDs from the list given in the prompt, never free text. */
  mustHaveActivityIds: z.array(z.string()),
  softPreferences: z.array(z.string()),
  /** Anything the notes leave unclear, for the form to highlight. */
  unclear: z.array(z.object({ field: DraftField, note: z.string() })),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutput>;

/**
 * The form's starting values. Fields stay null when the notes didn't give
 * them; the specialist fills those in before any search runs.
 */
export interface DraftBrief {
  windowStart: string | null;
  windowEnd: string | null;
  /** Always per person. A total in the notes is divided by the party size. */
  budgetPerPersonGbp: number | null;
  /** Shown beside the budget field, e.g. "£24,000 total ÷ 2 people". */
  budgetConversion: string | null;
  partySize: number | null;
  partyDescription: string;
  soloPreference: "own_cabin" | "will_share" | "either";
  mustHaveActivityIds: string[];
  softPreferences: string[];
  unclear: { field: DraftField; note: string }[];
}
