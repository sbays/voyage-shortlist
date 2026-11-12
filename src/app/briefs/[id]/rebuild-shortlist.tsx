"use client";

import { useActionState } from "react";
import type { RebuildState } from "@/app/action-types";
import styles from "../briefs.module.css";

const IDLE: RebuildState = { status: "idle" };

interface RebuildShortlistProps {
  /** rebuildShortlistAction bound to this brief on the server. */
  action: (previous: RebuildState, formData: FormData) => Promise<RebuildState>;
  /** When the shown shortlist was built, already formatted; null if never. */
  builtAt: string | null;
  /** Matches not yet seen that are still available. */
  newMatches: number;
}

/**
 * Says how old the shown shortlist is and offers to rebuild it. The page
 * re-renders with the new shortlist when the rebuild succeeds. It sits under
 * the page's "Latest shortlist" h2, before the shortlist's own h3.
 */
export function RebuildShortlist({ action, builtAt, newMatches }: RebuildShortlistProps) {
  const [state, rebuild, pending] = useActionState(action, IDLE);
  const matchesText =
    newMatches > 0
      ? `${newMatches} new ${newMatches === 1 ? "match" : "matches"}${builtAt ? " since then" : ""}. `
      : "";

  return (
    <section className={styles.rebuild} aria-labelledby="rebuild-heading">
      <h3 id="rebuild-heading" className={styles.rebuildHeading}>
        {builtAt ? "Is this still current?" : "Build a shortlist"}
      </h3>
      <p>
        {builtAt ? <>Built {builtAt}. </> : null}
        {matchesText ? <strong>{matchesText}</strong> : null}
        {builtAt
          ? "Availability may have changed since then."
          : "No shortlist has been built for this brief yet."}
      </p>
      <form action={rebuild} className={styles.rebuildActions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending
            ? "Rebuilding…"
            : builtAt
              ? "Rebuild with current availability"
              : "Build a shortlist"}
        </button>
        <p className={styles.muted}>
          Searches again, ranks with Claude and writes a fresh email. The earlier shortlist
          stays in the log.
        </p>
      </form>
      <div role="status">
        {state.status === "rebuilt" && !pending ? <p>Rebuilt just now.</p> : null}
      </div>
      <div role="alert">
        {state.status === "error" ? <p className={styles.error}>{state.message}</p> : null}
      </div>
    </section>
  );
}
