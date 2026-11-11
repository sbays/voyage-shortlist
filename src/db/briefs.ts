import type { CallUsage } from "../claude/models.ts";
import type { ClaudeFailureKind } from "../claude/errors.ts";
import { Brief } from "../domain/brief.ts";
import type { Shortlist } from "../domain/shortlist.ts";
import type { Db } from "./db.ts";

// Briefs and the shortlist log. Every write takes a Brief that has already
// passed the Zod schema, and every read parses it again, so a bad row fails
// loudly instead of reaching a query.

export interface StoredBrief {
  id: string;
  rawNotes: string;
  brief: Brief;
  title: string;
  saved: boolean;
  savedAt: string | null;
  createdAt: string;
}

interface BriefRow {
  id: string;
  raw_notes: string;
  criteria: unknown;
  title: string;
  saved: boolean;
  saved_at: Date | string | null;
  created_at: Date | string;
}

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

function toStoredBrief(row: BriefRow): StoredBrief {
  return {
    id: row.id,
    rawNotes: row.raw_notes,
    brief: Brief.parse(row.criteria),
    title: row.title,
    saved: row.saved,
    savedAt: row.saved_at === null ? null : iso(row.saved_at),
    createdAt: iso(row.created_at),
  };
}

/** A short list label: the party description, or the dates when there isn't one. */
export function briefTitle(brief: Brief): string {
  const party = brief.partyDescription.trim();
  if (party) return party.length > 80 ? `${party.slice(0, 79)}…` : party;
  return `${brief.rules.partySize} travelling, ${brief.rules.windowStart} to ${brief.rules.windowEnd}`;
}

export async function createBrief(db: Db, rawNotes: string, brief: Brief): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO briefs (raw_notes, criteria, title) VALUES ($1, $2, $3) RETURNING id",
    [rawNotes, JSON.stringify(brief), briefTitle(brief)],
  );
  return row.id;
}

/** Null for an unknown ID or one that isn't a UUID. */
export async function getBrief(db: Db, id: string): Promise<StoredBrief | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.query<BriefRow>("SELECT * FROM briefs WHERE id = $1", [id]);
  return row ? toStoredBrief(row) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marks a brief saved and records its current candidates, so the nightly job
 * never reports them as new. Saving twice keeps the first saved_at and adds
 * any candidates that have appeared since. Returns when it was saved, or null
 * for an unknown ID.
 */
export async function saveBrief(
  db: Db,
  id: string,
  candidateIds: string[],
): Promise<string | null> {
  if (!UUID.test(id)) return null;
  return db.transaction(async (tx) => {
    const [updated] = await tx.query<{ saved_at: Date | string }>(
      `UPDATE briefs SET saved = true, saved_at = coalesce(saved_at, now())
       WHERE id = $1 RETURNING saved_at`,
      [id],
    );
    if (!updated) return null;
    await recordKnownDepartures(tx, id, candidateIds);
    return iso(updated.saved_at);
  });
}

/**
 * Records departures as already known to a brief, so the nightly job never
 * reports them as new. Unknown departure IDs are ignored.
 */
export async function recordKnownDepartures(
  db: Db,
  briefId: string,
  departureIds: string[],
): Promise<void> {
  await db.query(
    `INSERT INTO brief_known_departures (brief_id, departure_id)
     SELECT $1, d.id FROM departures d WHERE d.id = ANY($2::text[])
     ON CONFLICT DO NOTHING`,
    [briefId, departureIds],
  );
}

export interface SavedBriefsForJobs {
  briefs: StoredBrief[];
  /** Saved briefs whose stored criteria no longer parse, with the reason. */
  unreadable: { id: string; error: string }[];
}

/**
 * Saved briefs for the background jobs. Unlike listSavedBriefs, a brief that
 * no longer parses (after a schema change, say) is reported and skipped
 * rather than failing the whole job.
 */
export async function listSavedBriefsForJobs(db: Db): Promise<SavedBriefsForJobs> {
  const rows = await db.query<BriefRow>(
    "SELECT * FROM briefs WHERE saved ORDER BY saved_at DESC, id",
  );
  const result: SavedBriefsForJobs = { briefs: [], unreadable: [] };
  for (const row of rows) {
    try {
      result.briefs.push(toStoredBrief(row));
    } catch (error) {
      result.unreadable.push({ id: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** Saved briefs, most recently saved first. */
export async function listSavedBriefs(db: Db): Promise<StoredBrief[]> {
  const rows = await db.query<BriefRow>(
    "SELECT * FROM briefs WHERE saved ORDER BY saved_at DESC, id",
  );
  return rows.map(toStoredBrief);
}

export interface ShortlistLog {
  briefId: string;
  candidateIds: string[];
  shortlist: Shortlist | null;
  failureKind: ClaudeFailureKind | null;
  usage: CallUsage[];
}

/** Logs one ranking run with its summed usage. Returns the shortlist row's ID. */
export async function logShortlist(db: Db, log: ShortlistLog): Promise<string> {
  const sum = (pick: (u: CallUsage) => number) => log.usage.reduce((n, u) => n + pick(u), 0);
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO shortlists (brief_id, candidate_ids, result, failure_kind, model, attempts,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      log.briefId,
      log.candidateIds,
      log.shortlist === null ? null : JSON.stringify(log.shortlist),
      log.failureKind,
      log.usage.at(-1)?.model ?? null,
      log.usage.length,
      sum((u) => u.inputTokens),
      sum((u) => u.outputTokens),
      sum((u) => u.cacheReadTokens),
      sum((u) => u.cacheWriteTokens),
      Math.round(sum((u) => u.latencyMs)),
    ],
  );
  return row.id;
}

export interface LoggedShortlist {
  shortlist: Shortlist;
  candidateCount: number;
  createdAt: string;
}

/** The brief's most recent successful shortlist, as rendered at the time. */
export async function getLatestShortlist(db: Db, briefId: string): Promise<LoggedShortlist | null> {
  if (!UUID.test(briefId)) return null;
  const [row] = await db.query<{ result: Shortlist; candidate_ids: string[]; created_at: Date | string }>(
    `SELECT result, candidate_ids, created_at FROM shortlists
     WHERE brief_id = $1 AND result IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [briefId],
  );
  if (!row) return null;
  return { shortlist: row.result, candidateCount: row.candidate_ids.length, createdAt: iso(row.created_at) };
}
