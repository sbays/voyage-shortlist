"use client";

import { useActionState, useState, type ReactNode } from "react";
import type { ActivityOption } from "@/db/catalogue";
import type { DraftBrief } from "@/domain/draft-brief";
import { runShortlistAction } from "../actions";
import { BRIEF_FIELDS, type BriefField, type ShortlistState } from "../action-types";
import { ShortlistView } from "../shortlist/shortlist-view";
import { describedBy, initialFormValues, unclearNotesByField, type BriefFormValues } from "./form-values";
import { readName, writeName } from "./specialist-name";
import styles from "./brief.module.css";

const INITIAL: ShortlistState = { status: "idle" };

const SOLO_OPTIONS: { value: BriefFormValues["soloPreference"]; label: string }[] = [
  { value: "either", label: "Either: whichever fits best" },
  { value: "own_cabin", label: "Own cabin, at the solo price" },
  { value: "will_share", label: "Happy to share with another traveller" },
];

interface BriefFormProps {
  notes: string;
  draft: DraftBrief;
  activities: ActivityOption[];
}

export function BriefForm({ notes, draft, activities }: BriefFormProps) {
  const [state, run, pending] = useActionState(runShortlistAction, INITIAL);
  const [values, setValues] = useState(() => initialFormValues(draft));
  // This form only mounts after an extraction, in the browser, so reading
  // storage in the initial state can't cause a hydration mismatch.
  const [name, setName] = useState(readName);
  const unclear = unclearNotesByField(draft.unclear);
  const errors = state.status === "invalid" ? state.fieldErrors : {};

  const set = <K extends keyof BriefFormValues>(key: K, value: BriefFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  // From the latest state, so two quick toggles in one batch both count.
  const toggleActivity = (id: string, checked: boolean) =>
    setValues((v) => ({
      ...v,
      mustHaveActivityIds: checked
        ? [...v.mustHaveActivityIds.filter((a) => a !== id), id]
        : v.mustHaveActivityIds.filter((a) => a !== id),
    }));

  /** aria props for one control, from its unclear notes, error and hint. */
  const aria = (field: BriefField, hint = false) => ({
    "aria-describedby": describedBy(field, {
      unclear: Boolean(unclear[field]),
      error: Boolean(errors[field]),
      hint,
    }),
    "aria-invalid": errors[field] ? true : undefined,
  });

  /**
   * For a <fieldset>: the description only. aria-invalid isn't supported on
   * the group role, so it goes on the checkboxes inside (see `invalid`). The
   * radio role doesn't support it either, so the cabin choice relies on the
   * error text the fieldset's aria-describedby points to.
   */
  const groupAria = (field: BriefField) => ({
    "aria-describedby": aria(field, true)["aria-describedby"],
  });
  const invalid = (field: BriefField) => (errors[field] ? true : undefined);

  const soloMatters = values.partySize.trim() === "1";

  return (
    <>
      <form action={run} className={styles.card} aria-labelledby="brief-heading">
        <h2 id="brief-heading" className={styles.heading}>
          2. Check the brief
        </h2>
        <p className={styles.hint}>
          Claude read these from the notes. Correct anything wrong before searching.
          {draft.unclear.length > 0
            ? ` ${draft.unclear.length} ${draft.unclear.length === 1 ? "item needs" : "items need"} checking, marked below.`
            : null}
        </p>
        <input type="hidden" name={BRIEF_FIELDS.rawNotes} value={notes} />

        <div className={styles.row}>
          <Field field="windowStart" label="Earliest start" unclear={unclear} errors={errors}>
            <input
              id="windowStart"
              name={BRIEF_FIELDS.windowStart}
              type="date"
              required
              className={styles.input}
              value={values.windowStart}
              onChange={(e) => set("windowStart", e.target.value)}
              {...aria("windowStart")}
            />
          </Field>
          <Field field="windowEnd" label="Latest return" unclear={unclear} errors={errors}>
            <input
              id="windowEnd"
              name={BRIEF_FIELDS.windowEnd}
              type="date"
              required
              min={values.windowStart || undefined}
              className={styles.input}
              value={values.windowEnd}
              onChange={(e) => set("windowEnd", e.target.value)}
              {...aria("windowEnd")}
            />
          </Field>
        </div>

        <div className={styles.row}>
          <Field
            field="budgetPerPersonGbp"
            label="Budget per person (£)"
            unclear={unclear}
            errors={errors}
            hint={
              draft.budgetConversion
                ? `From the notes: ${draft.budgetConversion}. Includes must-have activities.`
                : "A hard ceiling, including must-have activities."
            }
          >
            <input
              id="budgetPerPersonGbp"
              name={BRIEF_FIELDS.budgetPerPersonGbp}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              required
              className={styles.input}
              value={values.budgetPerPersonGbp}
              onChange={(e) => set("budgetPerPersonGbp", e.target.value)}
              {...aria("budgetPerPersonGbp", true)}
            />
          </Field>
          <Field field="partySize" label="Travellers" unclear={unclear} errors={errors}>
            <input
              id="partySize"
              name={BRIEF_FIELDS.partySize}
              type="number"
              min={1}
              step={1}
              required
              className={styles.input}
              value={values.partySize}
              onChange={(e) => set("partySize", e.target.value)}
              {...aria("partySize")}
            />
          </Field>
        </div>

        <fieldset
          className={`${styles.fieldset} ${unclear.soloPreference ? styles.flagged : ""}`}
          {...groupAria("soloPreference")}
        >
          <legend className={styles.label}>Cabin, for a solo traveller</legend>
          <p id="soloPreference-hint" className={styles.hint}>
            {soloMatters
              ? "Travelling alone: choose how they want to sleep."
              : "Only used when one person is travelling."}
          </p>
          <Notes field="soloPreference" unclear={unclear} errors={errors} />
          {SOLO_OPTIONS.map((option) => (
            <label key={option.value} className={styles.choice}>
              <input
                type="radio"
                name={BRIEF_FIELDS.soloPreference}
                value={option.value}
                checked={values.soloPreference === option.value}
                onChange={() => set("soloPreference", option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        <fieldset
          className={`${styles.fieldset} ${unclear.mustHaveActivityIds ? styles.flagged : ""}`}
          {...groupAria("mustHaveActivityIds")}
        >
          <legend className={styles.label}>Must-have activities</legend>
          <p id="mustHaveActivityIds-hint" className={styles.hint}>
            Only what they insist on: departures without it are left out. Nice-to-haves go in
            preferences.
          </p>
          <Notes field="mustHaveActivityIds" unclear={unclear} errors={errors} />
          {activities.map((activity) => (
            <label key={activity.id} className={styles.choice}>
              <input
                type="checkbox"
                name={BRIEF_FIELDS.mustHaveActivityIds}
                value={activity.id}
                checked={values.mustHaveActivityIds.includes(activity.id)}
                onChange={(e) => toggleActivity(activity.id, e.target.checked)}
                aria-invalid={invalid("mustHaveActivityIds")}
              />
              {activity.name}
            </label>
          ))}
        </fieldset>

        <Field field="partyDescription" label="Who's travelling" unclear={unclear} errors={errors}>
          <input
            id="partyDescription"
            name={BRIEF_FIELDS.partyDescription}
            type="text"
            className={styles.input}
            value={values.partyDescription}
            onChange={(e) => set("partyDescription", e.target.value)}
            {...aria("partyDescription")}
          />
        </Field>

        <Field
          field="softPreferences"
          label="Preferences"
          unclear={unclear}
          errors={errors}
          hint="One per line, such as “prefers a small ship”. These guide the ranking, not the search."
        >
          <textarea
            id="softPreferences"
            name={BRIEF_FIELDS.softPreferences}
            rows={4}
            className={styles.textarea}
            value={values.softPreferences}
            onChange={(e) => set("softPreferences", e.target.value)}
            {...aria("softPreferences", true)}
          />
        </Field>

        <div className={styles.field}>
          <label htmlFor="specialistName" className={styles.label}>
            Your name
          </label>
          <p id="specialistName-hint" className={styles.hint}>
            Signs the draft email. Kept in this browser only, never sent to the server.
          </p>
          {/* No name attribute, so the form never posts it. */}
          <input
            id="specialistName"
            type="text"
            autoComplete="name"
            className={styles.input}
            value={name}
            aria-describedby="specialistName-hint"
            onChange={(e) => {
              setName(e.target.value);
              writeName(e.target.value);
            }}
          />
        </div>

        <div role="alert" className={styles.alertRegion}>
          {state.status === "error" ? <p className={styles.error}>{state.message}</p> : null}
          {state.status === "invalid" ? (
            <p className={styles.error}>Some fields need fixing. They&apos;re marked above.</p>
          ) : null}
        </div>
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={pending}>
            {pending ? "Searching and ranking…" : "Build the shortlist"}
          </button>
          {pending ? (
            <p className={styles.hint}>Ranking can take up to a minute.</p>
          ) : null}
        </div>
      </form>

      {state.status === "ok" ? (
        <div className={styles.result}>
          <ShortlistView result={state.result} specialistName={name.trim()} />
        </div>
      ) : null}
    </>
  );
}

interface NotesProps {
  field: BriefField;
  unclear: Partial<Record<BriefField, string[]>>;
  errors: Partial<Record<BriefField, string>>;
}

/** The extraction's doubts and the server's error for one field. */
function Notes({ field, unclear, errors }: NotesProps) {
  const doubts = unclear[field];
  return (
    <>
      {doubts ? (
        <ul id={`${field}-unclear`} className={styles.unclear}>
          {doubts.map((note, i) => (
            <li key={i}>Check: {note}</li>
          ))}
        </ul>
      ) : null}
      {errors[field] ? (
        <p id={`${field}-error`} className={styles.error}>
          {errors[field]}
        </p>
      ) : null}
    </>
  );
}

interface FieldProps extends NotesProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

function Field({ field, label, hint, unclear, errors, children }: FieldProps) {
  return (
    <div className={`${styles.field} ${unclear[field] ? styles.flagged : ""}`}>
      <label htmlFor={field} className={styles.label}>
        {label}
      </label>
      {hint ? (
        <p id={`${field}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {children}
      <Notes field={field} unclear={unclear} errors={errors} />
    </div>
  );
}
