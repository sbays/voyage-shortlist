"use client";

import { useActionState, useState } from "react";
import { extractBriefAction } from "../actions";
import { MAX_NOTES_LENGTH, NOTES_FIELD, type ExtractState } from "../action-types";
import { BriefForm } from "./brief-form";
import { isNotesProblem } from "./form-values";
import styles from "./brief.module.css";

const INITIAL: ExtractState = { status: "idle" };

type Extracted = Extract<ExtractState, { status: "ok" }>;

/**
 * Notes, then the brief form, then the shortlist. Inputs are controlled:
 * React resets uncontrolled fields after a form action, which would wipe
 * the notes and the specialist's corrections.
 */
export function ShortlistBuilder() {
  const [state, extract, pending] = useActionState(extractBriefAction, INITIAL);
  const [notes, setNotes] = useState("");
  // The brief form comes from the last successful reading, so a failed
  // re-read (or a rate limit) never takes away the specialist's corrections.
  // Each new reading gets a fresh form, keyed by its number.
  const [latest, setLatest] = useState<{ reading: Extracted; number: number } | null>(null);
  const [seen, setSeen] = useState<ExtractState>(INITIAL);
  if (state !== seen) {
    setSeen(state);
    if (state.status === "ok") {
      setLatest((prev) => ({ reading: state, number: (prev?.number ?? 0) + 1 }));
    }
  }

  const hasBrief = latest !== null;
  // Only an empty or over-long box is the notes' fault; a rate limit or a
  // failed call shows the same alert without marking the field invalid.
  const notesInvalid = state.status === "error" && isNotesProblem(state.notes);

  return (
    <>
      <form action={extract} className={styles.card} aria-labelledby="notes-heading">
        <h2 id="notes-heading" className={styles.heading}>
          1. Call notes
        </h2>
        <label htmlFor="notes" className={styles.label}>
          Paste your rough notes from the customer call
        </label>
        <p id="notes-hint" className={styles.hint}>
          This is a public demo and other visitors can see what you enter. Don&apos;t paste
          real names, contact details or anything personal.
        </p>
        <textarea
          id="notes"
          name={NOTES_FIELD}
          className={styles.textarea}
          rows={8}
          maxLength={MAX_NOTES_LENGTH}
          required
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-describedby={
            state.status === "error" ? "notes-hint notes-error" : "notes-hint"
          }
          aria-invalid={notesInvalid || undefined}
        />
        <p className={styles.counter}>
          {notes.length.toLocaleString("en-GB")} of {MAX_NOTES_LENGTH.toLocaleString("en-GB")}{" "}
          characters
        </p>
        <div role="alert" id="notes-error" className={styles.alertRegion}>
          {state.status === "error" ? <p className={styles.error}>{state.message}</p> : null}
        </div>
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={pending}>
            {pending ? "Reading the notes…" : hasBrief ? "Read the notes again" : "Extract the brief"}
          </button>
          {hasBrief ? (
            <p className={styles.hint}>Reading them again replaces the brief below.</p>
          ) : null}
        </div>
      </form>

      {latest ? (
        <BriefForm
          key={latest.number}
          notes={latest.reading.notes}
          draft={latest.reading.draft}
          activities={latest.reading.activities}
        />
      ) : null}
    </>
  );
}
