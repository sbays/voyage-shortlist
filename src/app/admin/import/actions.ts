"use server";

import { clientIp } from "@/lib/client-ip";
import { importAvailability, listRecentImports, MAX_IMPORT_BYTES } from "@/db/availability-import";
import { getDb } from "@/db/connection";
import {
  adminTokenKey,
  countAgainst,
  FAILED_TOKEN_ATTEMPTS_PER_HOUR,
  isOverLimit,
} from "@/db/rate-limit";
import { storeImportFile } from "@/lib/storage";
import { FILE_FIELD, INTENT_FIELD, TOKEN_FIELD, type ImportState } from "./state";
import { checkAdminToken } from "./token";

// Uploads an availability CSV. A public POST endpoint, so it refuses an
// address that has sent too many wrong tokens, checks the token before
// reading the file, and never trusts the file's contents. Recent imports are
// only returned to someone who has just given the right token.

const UNAVAILABLE = "Uploads aren't available right now.";

export async function importAvailabilityAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  try {
    const db = await getDb();
    const attemptsKey = adminTokenKey(await clientIp());
    const limited = await isOverLimit(db, attemptsKey, FAILED_TOKEN_ATTEMPTS_PER_HOUR);
    if (limited.over) {
      const minutes = Math.max(1, Math.ceil(limited.retryAfterSeconds / 60));
      return {
        status: "error",
        message: `Too many wrong admin tokens from this address. Try again in ${minutes} minutes.`,
      };
    }

    const token = formData.get(TOKEN_FIELD);
    const check = checkAdminToken(typeof token === "string" ? token : "", process.env.DEMO_ADMIN_TOKEN);
    if (check === "not_configured") {
      console.error("Availability upload refused: DEMO_ADMIN_TOKEN isn't set");
      return { status: "error", message: UNAVAILABLE };
    }
    if (check === "wrong") {
      await countAgainst(db, attemptsKey);
      return { status: "error", message: "That admin token isn't right." };
    }

    if (formData.get(INTENT_FIELD) === "list") {
      return { status: "recent", recent: await listRecentImports(db) };
    }

    const file = formData.get(FILE_FIELD);
    if (!(file instanceof File) || file.size === 0) {
      return { status: "error", message: "Choose a CSV file to upload." };
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return { status: "error", message: "The file is over 1 MB." };
    }

    const text = await file.text();
    const storagePath = await storeImportFile(file.name, text);
    const result = await importAvailability(db, { filename: file.name, text, storagePath });
    const recent = await listRecentImports(db);
    return result.status === "applied"
      ? {
          status: "applied",
          filename: file.name,
          rowsUpdated: result.rowsUpdated,
          departuresUpdated: result.departuresUpdated,
          recent,
        }
      : { status: "rejected", filename: file.name, rowsTotal: result.rowsTotal, errors: result.errors, recent };
  } catch (error) {
    console.error("Availability import failed", error);
    return { status: "error", message: "The import couldn't be run. Nothing was changed. Try again." };
  }
}
