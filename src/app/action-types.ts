import type { ActivityOption } from "@/db/catalogue";
import type { ExclusionCount } from "@/db/search";
import type { Brief } from "@/domain/brief";
import type { DraftBrief } from "@/domain/draft-brief";
import { MAX_NOTES_LENGTH } from "@/domain/limits";
import type { Shortlist } from "@/domain/shortlist";

// What the server actions in ./actions.ts return. A "use server" file can
// only export async functions, so the shapes live here. Every value is plain
// data: it crosses the server/client boundary as a Flight payload.

/** Form field names the brief form posts and `parseBriefForm` reads. */
export const BRIEF_FIELDS = {
  rawNotes: "rawNotes",
  windowStart: "windowStart",
  windowEnd: "windowEnd",
  budgetPerPersonGbp: "budgetPerPersonGbp",
  partySize: "partySize",
  soloPreference: "soloPreference",
  /** Repeated: one value per checked activity. */
  mustHaveActivityIds: "mustHaveActivityIds",
  partyDescription: "partyDescription",
  /** One preference per line. */
  softPreferences: "softPreferences",
} as const;
export type BriefField = keyof typeof BRIEF_FIELDS;

/** The notes box posts this one field. */
export const NOTES_FIELD = "notes";
export { MAX_NOTES_LENGTH };

export type ExtractState =
  | { status: "idle" }
  | {
      status: "ok";
      notes: string;
      draft: DraftBrief;
      /** Every activity, for the must-have checkboxes. */
      activities: ActivityOption[];
    }
  | { status: "error"; notes: string; message: string };

export interface ShortlistResult {
  briefId: string;
  brief: Brief;
  shortlist: Shortlist;
  /** Every departure that met the hard rules, ranked or not. */
  candidateCount: number;
  /**
   * Only when nothing fits and nothing is close (0 candidates, 0 near
   * misses): how many departures each rule excluded, most first. Claude
   * isn't called in that case and `shortlist` is empty.
   */
  exclusions: ExclusionCount[];
  /**
   * The oldest availability timestamp among the departures shown (picks and
   * near misses): "availability as of". Null only when nothing is shown.
   */
  availabilityAsOf: string | null;
  saved: boolean;
}

export type ShortlistState =
  | { status: "idle" }
  | { status: "ok"; result: ShortlistResult }
  /** The form didn't validate; nothing was searched or stored. */
  | { status: "invalid"; fieldErrors: Partial<Record<BriefField, string>> }
  | { status: "error"; message: string };

export type SaveBriefState =
  | { status: "idle" }
  | { status: "saved"; savedAt: string }
  | { status: "error"; message: string };

export type RebuildState =
  | { status: "idle" }
  | { status: "rebuilt" }
  | { status: "error"; message: string };
