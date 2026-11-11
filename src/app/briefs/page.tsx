import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listSavedBriefs } from "@/db/briefs";
import { getDb } from "@/db/connection";
import { countUnseenMatches, lastMatchRun } from "@/db/matches";
import { formatDate, formatTimestamp } from "@/lib/dates";
import { formatGbp } from "@/lib/money";
import styles from "./briefs.module.css";
import { LastChecked } from "./last-checked";

export const metadata: Metadata = {
  title: "Saved briefs · Tern & Floe",
};

export default function SavedBriefsPage() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Saved briefs</h1>
      <p className={styles.lede}>
        Each night, saved briefs are checked for departures that newly fit. In
        this demo every visitor sees the same list.
      </p>
      <Suspense fallback={<p className={styles.muted}>Loading saved briefs…</p>}>
        <SavedBriefList />
      </Suspense>
    </main>
  );
}

// Saved briefs and their matches change, so this reads at request time.
async function SavedBriefList() {
  await connection();
  const db = await getDb();
  const [briefs, unseen, lastRun] = await Promise.all([
    listSavedBriefs(db),
    countUnseenMatches(db),
    lastMatchRun(db),
  ]);

  return (
    <>
      <LastChecked run={lastRun} />
      {briefs.length === 0 ? (
        <p className={styles.empty}>
          No saved briefs yet. <Link href="/">Build a shortlist</Link>, then choose
          &ldquo;Save brief&rdquo; to have it checked for new matches each night.
        </p>
      ) : (
        <ul className={styles.list}>
          {briefs.map(({ id, title, brief, savedAt }) => {
            const count = unseen.get(id) ?? 0;
            return (
              <li key={id} className={styles.card}>
                <Link href={`/briefs/${id}`} className={styles.cardTitle}>
                  {title}
                </Link>
                {count > 0 && (
                  <span className={styles.badge}>
                    {count} new {count === 1 ? "match" : "matches"}
                  </span>
                )}
                <p className={styles.facts}>
                  <span>
                    {formatDate(brief.rules.windowStart)} to {formatDate(brief.rules.windowEnd)}
                  </span>
                  <span>{formatGbp(brief.rules.budgetPerPersonGbp)} per person</span>
                  <span>
                    {brief.rules.partySize} {brief.rules.partySize === 1 ? "traveller" : "travellers"}
                  </span>
                  {savedAt && <span>Saved {formatTimestamp(savedAt)}</span>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
