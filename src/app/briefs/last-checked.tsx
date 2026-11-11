import type { MatchRun } from "@/db/matches";
import { formatTimestamp } from "@/lib/dates";
import styles from "./briefs.module.css";

/** When the nightly job last checked saved briefs for new matches. */
export function LastChecked({ run }: { run: MatchRun | null }) {
  return (
    <p className={styles.muted}>
      {run
        ? `Matches last checked ${formatTimestamp(run.finishedAt)}.`
        : "Matches haven't been checked yet. The first check runs tonight."}
    </p>
  );
}
