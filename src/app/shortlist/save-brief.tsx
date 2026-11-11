"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveBriefAction } from "../actions";
import type { SaveBriefState } from "../action-types";
import { formatTimestamp } from "@/lib/dates";
import styles from "./shortlist.module.css";

interface SaveBriefProps {
  briefId: string;
  saved: boolean;
}

export function SaveBrief({ briefId, saved }: SaveBriefProps) {
  const [state, setState] = useState<SaveBriefState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const isSaved = saved || state.status === "saved";

  function save() {
    startTransition(async () => {
      try {
        setState(await saveBriefAction(briefId));
      } catch {
        setState({ status: "error", message: "Couldn't save the brief. Try again." });
      }
    });
  }

  return (
    <section className={styles.section} aria-label="Save this brief">
      <p className={styles.muted}>
        Save the brief to hear about new departures that fit it under &ldquo;New matches&rdquo;.
        Saved briefs are visible to every visitor to this demo.
      </p>
      <div className={styles.actions}>
        {!isSaved && (
          <button type="button" className={styles.button} onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save brief"}
          </button>
        )}
        <p className={styles.status} aria-live="polite">
          {state.status === "saved" && <>Saved {formatTimestamp(state.savedAt)}. </>}
          {isSaved && <Link href="/briefs">See saved briefs</Link>}
          {state.status === "error" && state.message}
        </p>
      </div>
    </section>
  );
}
