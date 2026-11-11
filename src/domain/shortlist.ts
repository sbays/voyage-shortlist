import { z } from "zod";
import type { Candidate, NearMiss } from "../db/search.ts";

// "Rank and explain": what goes in, what Claude returns, and what the server
// renders after checking every ID. Prices, dates and ship names on screen
// always come from Candidate and NearMiss (the database), never from model text.

/** At most this many candidates go to the ranking call, earliest first. */
export const MAX_RANKED_CANDIDATES = 20;
export const MAX_PICKS = 3;

/** Structured-outputs schema: no ranges or lengths; counts are checked in code. */
export const RankingOutput = z.object({
  picks: z.array(
    z.object({
      departureId: z.string(),
      cabinCategoryId: z.string(),
      /** One sentence on why it fits this brief. */
      reason: z.string(),
      /** One honest downside. */
      tradeOff: z.string(),
    }),
  ),
  /** Near misses worth raising with the customer, with the trade-off in words. */
  nearMissNotes: z.array(z.object({ departureId: z.string(), note: z.string() })),
  /**
   * The draft email in the specialist's voice. Facts appear only as
   * placeholders the server fills from the database, for example
   * {{departure:dep_014.price}}. See PLACEHOLDER_FIELDS.
   */
  emailBody: z.string(),
});
export type RankingOutput = z.infer<typeof RankingOutput>;

/** The facts an email placeholder can name: {{departure:<id>.<field>}}. */
export const PLACEHOLDER_FIELDS = [
  "ship",
  "voyage",
  "dates",
  "nights",
  "cabin",
  "price",
  "operator",
  "embark_port",
  "availability_as_of",
] as const;
export type PlaceholderField = (typeof PLACEHOLDER_FIELDS)[number];

export interface ShortlistPick {
  rank: number;
  candidate: Candidate;
  /** The fare Claude chose, looked up from the candidate's qualifying fares. */
  fare: Candidate["fares"][number];
  reason: string;
  tradeOff: string;
}

export interface Shortlist {
  picks: ShortlistPick[];
  nearMisses: { nearMiss: NearMiss; note: string | null }[];
  /** Placeholders already filled from the database; {{specialist_name}} left for the UI. */
  emailBody: string;
  /** Candidates that qualified but weren't sent to ranking (over MAX_RANKED_CANDIDATES). */
  unrankedCount: number;
}
