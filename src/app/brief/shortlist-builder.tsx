"use client";

import { useActionState, useRef, useState } from "react";
import { extractBriefAction } from "../actions";
import { MAX_NOTES_LENGTH, NOTES_FIELD, type ExtractState } from "../action-types";
import { BriefForm } from "./brief-form";
import type { ExampleNotes } from "./example-notes";
import { ExampleNotesCard } from "./example-notes-card";
import { isNotesProblem } from "./form-values";
import styles from "./brief.module.css";

const INITIAL: ExtractState = { status: "idle" };

type Extracted = Extract<ExtractState, { status: "ok" }>;

/**
 * Notes, then the brief form, then the shortlist. Inputs are controlled:
 * React resets uncontrolled fields after a form action, which would wipe
 * the notes and the specialist's corrections.
 */
interface ShortlistBuilderProps {
  /** Example notes dated for the season in the database, streamed in. */
  examples: Promise<ExampleNotes[]>;
}

export function ShortlistBuilder({ examples }: ShortlistBuilderProps) {
  const [state, extract, pending] = useActionState(extractBriefAction, INITIAL);
  const [notes, setNotes] = useState("");
  const notesRef = useRef<HTMLTextAreaElement>(null);
  // The specialist's own notes from before an example replaced them, so they
  // can be restored. Cleared once they type again.
  const [ownNotes, setOwnNotes] = useState<string | null>(null);
  // The example last loaded into the box, so loading another doesn't offer
  // to "restore" an example as if the specialist had written it.
  const [loadedExample, setLoadedExample] = useState<string | null>(null);
  // An error is hidden once an example is loaded, since it was about the
  // notes that example replaced. A new submit brings a new state object.
  const [dismissedError, setDismissedError] = useState<ExtractState | null>(null);
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

  // Loading an example moves focus to the box, so keyboard and screen reader
  // users land on the notes they just loaded and can read or extract them.
  function pickExample(example: string) {
    // Only text the specialist wrote is worth restoring, not an earlier example.
    const isOwn = notes.trim() !== "" && notes !== loadedExample;
    if (isOwn) setOwnNotes(notes);
    setNotes(example);
    setLoadedExample(example);
    setDismissedError(state);
    notesRef.current?.focus();
  }

  function restoreOwnNotes() {
    if (ownNotes === null) return;
    setNotes(ownNotes);
    setOwnNotes(null);
    notesRef.current?.focus();
  }

  const hasBrief = latest !== null;
  const error = state.status === "error" && state !== dismissedError ? state : null;
  // The notes have changed since the brief below was read from them.
  const briefOutOfStep = latest !== null && notes.trim() !== latest.reading.notes;
  // Only an empty or over-long box is the notes' fault; a rate limit or a
  // failed call shows the same alert without marking the field invalid.
  const notesInvalid = error !== null && isNotesProblem(error.notes);

  return (
    <>
      <ExampleNotesCard examples={examples} onPick={pickExample} disabled={pending} />
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
          ref={notesRef}
          name={NOTES_FIELD}
          className={styles.textarea}
          rows={8}
          maxLength={MAX_NOTES_LENGTH}
          required
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setOwnNotes(null);
          }}
          aria-describedby={
            error ? "notes-hint notes-error" : "notes-hint"
          }
          aria-invalid={notesInvalid || undefined}
        />
        <p className={styles.counter}>
          {notes.length.toLocaleString("en-GB")} of {MAX_NOTES_LENGTH.toLocaleString("en-GB")}{" "}
          characters
        </p>
        <div role="alert" id="notes-error" className={styles.alertRegion}>
          {error ? <p className={styles.error}>{error.message}</p> : null}
        </div>
        <div aria-live="polite" className={styles.status}>
          {ownNotes !== null ? (
            <p>
              An example replaced your notes.{" "}
              <button type="button" className={styles.link} onClick={restoreOwnNotes}>
                Restore your notes
              </button>
            </p>
          ) : null}
          {briefOutOfStep ? (
            <p>These notes have changed since the brief below was read. Extract the brief again to use them.</p>
          ) : null}
        </div>
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={pending}>
            {pending ? "Reading the notes…" : hasBrief ? "Read the notes again" : "Extract the brief"}
          </button>
          {hasBrief && !briefOutOfStep ? (
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
