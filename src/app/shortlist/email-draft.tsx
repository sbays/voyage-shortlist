"use client";

import { useId, useState } from "react";
import { fillSpecialistName } from "./format";
import { Heading, type HeadingTag } from "./heading";
import styles from "./shortlist.module.css";

interface EmailDraftProps {
  /** Placeholders already filled from the database, except the sign-off. */
  emailBody: string;
  specialistName: string;
  /** One level below the shortlist's title. */
  headingTag: HeadingTag;
}

type CopyStatus = "idle" | "copied" | "failed";

/**
 * The draft email. It follows the specialist's name until they edit it, then
 * keeps their text. Remount it (a new `key`) for a new shortlist.
 */
export function EmailDraft({ emailBody, specialistName, headingTag }: EmailDraftProps) {
  const id = useId();
  const [edited, setEdited] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const value = edited ?? fillSpecialistName(emailBody, specialistName);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <section className={styles.section} aria-labelledby={`${id}-heading`}>
      <Heading tag={headingTag} id={`${id}-heading`} className={styles.heading}>
        Draft email
      </Heading>
      <p className={styles.muted}>
        Prices, dates and ship names come from the database. Edit it as you like, then copy it into
        your own email. This tool sends nothing.
      </p>
      <label htmlFor={`${id}-body`} className={styles.label}>
        Email to the customer
      </label>
      <textarea
        id={`${id}-body`}
        className={styles.email}
        value={value}
        rows={16}
        onChange={(event) => {
          setEdited(event.target.value);
          setCopyStatus("idle");
        }}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={copy}>
          Copy email
        </button>
        {edited !== null && (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              setEdited(null);
              setCopyStatus("idle");
            }}
          >
            Undo my edits
          </button>
        )}
        <p className={styles.status} aria-live="polite">
          {copyStatus === "copied" && "Copied to the clipboard."}
          {copyStatus === "failed" &&
            "Couldn't reach the clipboard. Select the text and copy it yourself."}
        </p>
      </div>
    </section>
  );
}
