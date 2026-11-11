"use client";

import { useActionState, useState } from "react";
import type { ImportSummary } from "@/db/availability-import";
import { formatTimestamp } from "@/lib/dates";
import { importAvailabilityAction } from "./actions";
import {
  FILE_FIELD,
  INTENT_FIELD,
  MAX_ERRORS_SHOWN,
  MAX_UPLOAD_BYTES,
  TOKEN_FIELD,
  type ImportState,
} from "./state";
import styles from "./import.module.css";

const INITIAL: ImportState = { status: "idle" };

export function ImportForm() {
  const [state, upload, pending] = useActionState(importAvailabilityAction, INITIAL);
  // Controlled, so React doesn't clear it after each submit. It stays in this
  // page's memory only: never stored, and gone on reload.
  const [token, setToken] = useState("");
  // Checked here as well as on the server: a file over the server's body
  // limit would never reach the action, so the page couldn't explain why.
  // Both buttons send the chosen file, so both wait for a smaller one.
  const [tooBig, setTooBig] = useState(false);

  return (
    <>
      <form action={upload} className={styles.card} aria-labelledby="upload-heading">
        <h2 id="upload-heading" className={styles.heading}>
          Upload a file
        </h2>
        <div className={styles.field}>
          <label htmlFor="import-file" className={styles.label}>
            Availability CSV
          </label>
          <input
            id="import-file"
            name={FILE_FIELD}
            type="file"
            accept=".csv,text/csv"
            className={styles.input}
            onChange={(e) => setTooBig((e.target.files?.[0]?.size ?? 0) > MAX_UPLOAD_BYTES)}
            aria-describedby={tooBig ? "import-file-hint import-file-error" : "import-file-hint"}
            aria-invalid={tooBig || undefined}
          />
          <p id="import-file-hint" className={styles.hint}>
            Up to 1 MB. One bad row rejects the whole file, and nothing changes.
          </p>
          {tooBig ? (
            <p id="import-file-error" className={styles.error}>
              That file is over 1 MB. Split it into smaller files.
            </p>
          ) : null}
        </div>
        <div className={styles.field}>
          {/* Password managers save a password against a username, so this
              hidden, unposted field gives the token one. It lets the browser
              offer to remember the token and fill it in next time; the app
              itself never stores it. */}
          <input type="text" autoComplete="username" value="admin" readOnly hidden />
          <label htmlFor="import-token" className={styles.label}>
            Admin token
          </label>
          <input
            id="import-token"
            name={TOKEN_FIELD}
            type="password"
            autoComplete="current-password"
            required
            aria-describedby="import-token-hint"
            className={styles.input}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <p id="import-token-hint" className={styles.hint}>
            Your browser&apos;s password manager can remember it for next time.
          </p>
        </div>
        <div className={styles.buttons}>
          <button type="submit" className={styles.primary} disabled={pending || tooBig}>
            {pending ? "Working…" : "Import availability"}
          </button>
          <button
            type="submit"
            name={INTENT_FIELD}
            value="list"
            className={styles.secondary}
            disabled={pending || tooBig}
          >
            Show recent imports
          </button>
        </div>
      </form>

      <div role="status" aria-live="polite" className={styles.result}>
        <ImportOutcome state={state} />
      </div>

      {"recent" in state ? <RecentImports imports={state.recent} /> : null}
    </>
  );
}

function ImportOutcome({ state }: { state: ImportState }) {
  switch (state.status) {
    case "idle":
    case "recent":
      return null;
    case "error":
      return <p className={styles.error}>{state.message}</p>;
    case "applied":
      return (
        <p className={styles.success}>
          Imported {state.filename}: {state.rowsUpdated} {state.rowsUpdated === 1 ? "fare" : "fares"} updated
          across {state.departuresUpdated} {state.departuresUpdated === 1 ? "departure" : "departures"}.
        </p>
      );
    case "rejected": {
      const shown = state.errors.slice(0, MAX_ERRORS_SHOWN);
      const hidden = state.errors.length - shown.length;
      return (
        <div className={styles.rejected}>
          <p className={styles.error}>
            {state.filename} was rejected, so no fares changed. Fix{" "}
            {state.errors.length === 1 ? "this error" : `these ${state.errors.length} errors`} and upload it
            again. Row numbers match a spreadsheet, with the header as row 1.
          </p>
          <ul className={styles.errors}>
            {shown.map((e) => (
              <li key={`${e.row}-${e.message}`}>
                {e.row === 0 ? "File" : `Row ${e.row}`}: {e.message}
              </li>
            ))}
          </ul>
          {hidden > 0 ? <p className={styles.hint}>And {hidden} more.</p> : null}
        </div>
      );
    }
  }
}

/** Shown only after a valid token: filenames come from whoever uploaded. */
function RecentImports({ imports }: { imports: ImportSummary[] }) {
  return (
    <section className={styles.section} aria-labelledby="recent-heading">
      <h2 id="recent-heading" className={styles.heading}>
        Recent imports
      </h2>
      {imports.length === 0 ? (
        <p className={styles.hint}>No imports yet.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className={styles.caption}>The 10 most recent uploads, newest first.</caption>
            <thead>
              <tr>
                <th scope="col">Uploaded</th>
                <th scope="col">File</th>
                <th scope="col">Result</th>
                <th scope="col" className={styles.number}>
                  Rows
                </th>
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td>{formatTimestamp(i.uploadedAt)}</td>
                  <td>{i.filename}</td>
                  <td>
                    {i.status === "applied"
                      ? `Applied, ${i.rowsUpdated} updated`
                      : `Rejected, ${i.errorCount} ${i.errorCount === 1 ? "error" : "errors"}`}
                  </td>
                  <td className={styles.number}>{i.rowsTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
