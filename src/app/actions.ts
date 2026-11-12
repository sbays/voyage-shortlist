"use server";

import { refresh } from "next/cache";
import { clientIp } from "@/lib/client-ip";
import {
  createBrief,
  getBrief,
  logShortlist,
  recordKnownDepartures,
  saveBrief,
  type ShortlistLog,
} from "@/db/briefs";
import type { Db } from "@/db/db";
import { listActivities } from "@/db/catalogue";
import { getDb } from "@/db/connection";
import { markMatchesSeen } from "@/db/matches";
import { consumeClaudeCalls, type RateLimitResult } from "@/db/rate-limit";
import { exclusionCounts, isoToday, searchDepartures } from "@/db/search";
import { extractBrief } from "@/claude/extract";
import { rankShortlist } from "@/claude/rank";
import { ClaudeCallError, type ClaudeFailureKind } from "@/claude/errors";
import { parseBriefForm } from "@/domain/brief-form";
import type { Brief } from "@/domain/brief";
import { availabilityAsOf } from "@/domain/shortlist";
import {
  MAX_NOTES_LENGTH,
  NOTES_FIELD,
  type ExtractState,
  type RebuildState,
  type SaveBriefState,
  type ShortlistResult,
  type ShortlistState,
} from "./action-types";

// The three entry points the UI calls. Each is a public POST endpoint, so
// each validates its own input and none trusts IDs or facts from the client:
// saving re-runs the search rather than taking candidate IDs from the form.

const FAILURE_MESSAGES: Record<ClaudeFailureKind, string> = {
  refusal: "Claude declined to process these notes. Try rewording them.",
  max_tokens: "Claude's answer was cut off. Try again, or shorten the notes.",
  invalid_output: "Claude's answer couldn't be read. Try again.",
  invalid_ids:
    "Claude named departures that weren't on the list, twice, so the ranking was rejected. Try again.",
  api: "Claude couldn't be reached. Try again in a minute.",
};

function failureMessage(error: unknown): string {
  console.error(error);
  if (error instanceof ClaudeCallError) return FAILURE_MESSAGES[error.kind];
  return "Something went wrong. Try again.";
}

function rateLimitMessage(result: Extract<RateLimitResult, { ok: false }>): string {
  const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
  return result.scope === "ip"
    ? `This demo allows 30 Claude calls an hour from one address. Try again in ${minutes} minutes.`
    : `The demo has reached its hourly limit for everyone. Try again in ${minutes} minutes.`;
}

/**
 * Logs a ranking run without letting a logging failure cost the specialist a
 * shortlist that was already paid for.
 */
async function logQuietly(db: Db, log: ShortlistLog): Promise<boolean> {
  try {
    await logShortlist(db, log);
    return true;
  } catch (error) {
    console.error("Couldn't log the shortlist run", error);
    return false;
  }
}

export async function extractBriefAction(
  _previous: ExtractState,
  formData: FormData,
): Promise<ExtractState> {
  const raw = formData.get(NOTES_FIELD);
  const notes = typeof raw === "string" ? raw.trim() : "";
  if (!notes) return { status: "error", notes, message: "Paste the notes from the call first." };
  if (notes.length > MAX_NOTES_LENGTH) {
    return {
      status: "error",
      notes,
      message: `Notes can be up to ${MAX_NOTES_LENGTH.toLocaleString("en-GB")} characters.`,
    };
  }

  try {
    const db = await getDb();
    const limit = await consumeClaudeCalls(db, await clientIp());
    if (!limit.ok) return { status: "error", notes, message: rateLimitMessage(limit) };
    const activities = await listActivities(db);
    const { draft } = await extractBrief(notes, activities);
    return { status: "ok", notes, draft, activities };
  } catch (error) {
    return { status: "error", notes, message: failureMessage(error) };
  }
}

export async function runShortlistAction(
  _previous: ShortlistState,
  formData: FormData,
): Promise<ShortlistState> {
  try {
    const db = await getDb();
    const activities = await listActivities(db);
    const parsed = parseBriefForm(
      formData,
      activities.map((a) => a.id),
    );
    if (!parsed.ok) {
      return parsed.message
        ? { status: "error", message: parsed.message }
        : { status: "invalid", fieldErrors: parsed.fieldErrors };
    }
    const { brief, rawNotes } = parsed;

    // Every run counts, even one with nothing to rank and so no Claude call:
    // each run stores a brief, and the limit is what caps those writes.
    const limit = await consumeClaudeCalls(db, await clientIp());
    if (!limit.ok) return { status: "error", message: rateLimitMessage(limit) };

    const briefId = await createBrief(db, rawNotes, brief);
    const { result } = await searchRankAndLog(db, briefId, brief, { withExclusions: true });
    return { status: "ok", result: { ...result, saved: false } };
  } catch (error) {
    return { status: "error", message: failureMessage(error) };
  }
}

interface RankedRun {
  /** Everything but `saved`, which only the caller knows. */
  result: Omit<ShortlistResult, "saved">;
  candidateIds: string[];
  /** False if the run couldn't be written to the shortlist log. */
  logged: boolean;
}

/**
 * The shared core of a shortlist run for a stored brief: search current
 * availability, rank, and log the run (a failed ranking is logged with its
 * usage before the error is re-thrown). Exclusion counts are only worked out
 * when the caller will show them.
 */
async function searchRankAndLog(
  db: Db,
  briefId: string,
  brief: Brief,
  options: { withExclusions: boolean },
): Promise<RankedRun> {
  const today = isoToday();
  const search = await searchDepartures(db, brief.rules, { today });
  const candidateIds = search.candidates.map((c) => c.departureId);
  const nothingClose = search.candidates.length === 0 && search.nearMisses.length === 0;

  let ranked: Awaited<ReturnType<typeof rankShortlist>>;
  try {
    ranked = await rankShortlist(brief, search);
  } catch (error) {
    if (error instanceof ClaudeCallError) {
      await logQuietly(db, {
        briefId,
        candidateIds,
        shortlist: null,
        failureKind: error.kind,
        usage: error.usage,
      });
    }
    throw error;
  }
  const { shortlist, usage } = ranked;
  const logged = await logQuietly(db, { briefId, candidateIds, shortlist, failureKind: null, usage });

  const exclusions =
    options.withExclusions && nothingClose ? await exclusionCounts(db, brief.rules, { today }) : [];
  return {
    result: {
      briefId,
      brief,
      shortlist,
      candidateCount: search.candidates.length,
      exclusions,
      availabilityAsOf: availabilityAsOf(shortlist),
    },
    candidateIds,
    logged,
  };
}

/**
 * Rebuilds a saved brief's shortlist against current availability. The
 * earlier shortlist stays in the log, and refresh() re-renders the page with
 * the new one (read back from the log). New matches are simply candidates
 * now, so the fresh search includes them.
 *
 * The brief's ID is bound to this action on the server, but bound arguments
 * travel with the request and anyone can POST another ID. What protects it is
 * that only saved briefs can be rebuilt (and saved briefs are public in the
 * demo) and that every rebuild counts against the rate limit.
 */
export async function rebuildShortlistAction(briefId: string): Promise<RebuildState> {
  try {
    const db = await getDb();
    const stored = await getBrief(db, briefId);
    if (!stored?.saved) return { status: "error", message: "That brief no longer exists." };

    const limit = await consumeClaudeCalls(db, await clientIp());
    if (!limit.ok) return { status: "error", message: rateLimitMessage(limit) };

    const searchStarted = new Date();
    const { candidateIds, logged } = await searchRankAndLog(db, stored.id, stored.brief, {
      withExclusions: false,
    });
    // The page shows the logged shortlist, so an unlogged rebuild is lost:
    // say so, and leave the matches as they were.
    if (!logged) {
      return { status: "error", message: "The rebuilt shortlist couldn't be saved. Try again." };
    }
    await db.transaction(async (tx) => {
      // What the specialist now sees is known, so the nightly job won't
      // report it as new; matches found while Claude was ranking stay new.
      await recordKnownDepartures(tx, stored.id, candidateIds);
      await markMatchesSeen(tx, stored.id, { foundBefore: searchStarted });
    });
    refresh();
    return { status: "rebuilt" };
  } catch (error) {
    return { status: "error", message: failureMessage(error) };
  }
}

/**
 * Saves a brief for "New matches". Its current candidates come from a fresh
 * search of the stored brief, never from the client.
 */
export async function saveBriefAction(briefId: string): Promise<SaveBriefState> {
  try {
    const db = await getDb();
    const stored = await getBrief(db, briefId);
    if (!stored) return { status: "error", message: "That brief no longer exists." };
    const { candidates } = await searchDepartures(db, stored.brief.rules, { today: isoToday() });
    const savedAt = await saveBrief(
      db,
      stored.id,
      candidates.map((c) => c.departureId),
    );
    return savedAt === null
      ? { status: "error", message: "That brief no longer exists." }
      : { status: "saved", savedAt };
  } catch (error) {
    return { status: "error", message: failureMessage(error) };
  }
}
