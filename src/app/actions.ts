"use server";

import { clientIp } from "@/lib/client-ip";
import { createBrief, getBrief, logShortlist, saveBrief, type ShortlistLog } from "@/db/briefs";
import type { Db } from "@/db/db";
import { listActivities } from "@/db/catalogue";
import { getDb } from "@/db/connection";
import { consumeClaudeCalls, type RateLimitResult } from "@/db/rate-limit";
import { exclusionCounts, isoToday, searchDepartures } from "@/db/search";
import { extractBrief } from "@/claude/extract";
import { rankShortlist } from "@/claude/rank";
import { ClaudeCallError, type ClaudeFailureKind } from "@/claude/errors";
import { parseBriefForm } from "@/domain/brief-form";
import { availabilityAsOf } from "@/domain/shortlist";
import {
  MAX_NOTES_LENGTH,
  NOTES_FIELD,
  type ExtractState,
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
async function logQuietly(db: Db, log: ShortlistLog): Promise<void> {
  try {
    await logShortlist(db, log);
  } catch (error) {
    console.error("Couldn't log the shortlist run", error);
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

    const today = isoToday();
    const search = await searchDepartures(db, brief.rules, { today });
    const candidateIds = search.candidates.map((c) => c.departureId);
    const nothingClose = search.candidates.length === 0 && search.nearMisses.length === 0;
    const briefId = await createBrief(db, rawNotes, brief);

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
    await logQuietly(db, { briefId, candidateIds, shortlist, failureKind: null, usage });

    const result: ShortlistResult = {
      briefId,
      brief,
      shortlist,
      candidateCount: search.candidates.length,
      exclusions: nothingClose ? await exclusionCounts(db, brief.rules, { today }) : [],
      availabilityAsOf: availabilityAsOf(shortlist),
      saved: false,
    };
    return { status: "ok", result };
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
