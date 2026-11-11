import type { ImportError, ImportSummary } from "@/db/availability-import";

// What the import action returns. A "use server" file can only export async
// functions, so the shape lives here. Client code imports this file, so it
// takes only types from the database module.

export const FILE_FIELD = "file";
export const TOKEN_FIELD = "token";
/** "list" asks only for the recent imports; anything else uploads. */
export const INTENT_FIELD = "intent";

/** The upload cap, checked in the browser too. Equal to MAX_IMPORT_BYTES (tested). */
export const MAX_UPLOAD_BYTES = 1_000_000;

/**
 * Recent imports are returned only after a valid token, never rendered for
 * the public: filenames come from whoever uploaded.
 */
export type ImportState =
  | { status: "idle" }
  | {
      status: "applied";
      filename: string;
      rowsUpdated: number;
      departuresUpdated: number;
      recent: ImportSummary[];
    }
  | { status: "rejected"; filename: string; rowsTotal: number; errors: ImportError[]; recent: ImportSummary[] }
  | { status: "recent"; recent: ImportSummary[] }
  | { status: "error"; message: string };

/** Errors shown on the page; the rest are counted. */
export const MAX_ERRORS_SHOWN = 100;
