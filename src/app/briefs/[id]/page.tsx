import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { ShortlistResult } from "@/app/action-types";
import { ShortlistView } from "@/app/shortlist/shortlist-view";
import { getBrief, getLatestShortlist, type StoredBrief } from "@/db/briefs";
import { listActivities } from "@/db/catalogue";
import { getDb } from "@/db/connection";
import { listMatches, type Match } from "@/db/matches";
import { exclusionCounts } from "@/db/search";
import { availabilityAsOf } from "@/domain/shortlist";
import { formatDate, formatTimestamp } from "@/lib/dates";
import { formatGbp } from "@/lib/money";
import { routeLabel } from "@/lib/routes";
import styles from "../briefs.module.css";

export const metadata: Metadata = {
  title: "Saved brief · Tern & Floe",
};

const SOLO_LABELS = {
  own_cabin: "Own cabin",
  will_share: "Happy to share",
  either: "Either",
} as const;

export default function SavedBriefPage({ params }: PageProps<"/briefs/[id]">) {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>
        <Link href="/briefs">Saved briefs</Link>
      </p>
      <Suspense fallback={<p className={styles.muted}>Loading brief…</p>}>
        <SavedBrief params={params} />
      </Suspense>
    </main>
  );
}

// The brief, its matches and availability all change, so this reads at request time.
async function SavedBrief({ params }: Pick<PageProps<"/briefs/[id]">, "params">) {
  await connection();
  const { id } = await params;
  const db = await getDb();
  const stored = await getBrief(db, id);
  // Only saved briefs have a page: an unsaved run is the visitor's own work.
  if (!stored?.saved) notFound();

  const [matches, latest, activities] = await Promise.all([
    listMatches(db, stored),
    getLatestShortlist(db, stored.id),
    listActivities(db),
  ]);
  // The log keeps the shortlist but not the exclusion counts, so a "nothing
  // fits" run recomputes them to name the rule that ruled out the most.
  const nothingShown =
    latest !== null && latest.shortlist.picks.length === 0 && latest.shortlist.nearMisses.length === 0;
  const exclusions = nothingShown ? await exclusionCounts(db, stored.brief.rules) : [];
  const activityNames = new Map(activities.map((a) => [a.id, a.name]));

  const result: ShortlistResult | null = latest && {
    briefId: stored.id,
    brief: stored.brief,
    shortlist: latest.shortlist,
    candidateCount: latest.candidateCount,
    exclusions,
    availabilityAsOf: availabilityAsOf(latest.shortlist),
    saved: stored.saved,
  };

  return (
    <>
      <h1 className={styles.title}>{stored.title}</h1>
      {stored.savedAt && <p className={styles.lede}>Saved {formatTimestamp(stored.savedAt)}</p>}
      <BriefCriteria stored={stored} activityNames={activityNames} />

      <section className={styles.section} aria-labelledby="new-matches">
        <h2 id="new-matches" className={styles.sectionTitle}>
          New matches
        </h2>
        <MatchList matches={matches} />
      </section>

      <section className={styles.section} aria-labelledby="latest-shortlist">
        <h2 id="latest-shortlist" className={styles.sectionTitle}>
          Latest shortlist
        </h2>
        {latest && result ? (
          <>
            <p className={styles.muted}>Built {formatTimestamp(latest.createdAt)}</p>
            <ShortlistView result={result} specialistName="" headingLevel={3} />
          </>
        ) : (
          <p className={styles.empty}>No shortlist has been built for this brief yet.</p>
        )}
      </section>
    </>
  );
}

function BriefCriteria({
  stored,
  activityNames,
}: {
  stored: StoredBrief;
  activityNames: Map<string, string>;
}) {
  const { rules, partyDescription, softPreferences } = stored.brief;
  const mustHaves = rules.mustHaveActivityIds.map((id) => activityNames.get(id) ?? id);
  return (
    <dl className={styles.criteria}>
      <dt>Dates</dt>
      <dd>
        {formatDate(rules.windowStart)} to {formatDate(rules.windowEnd)}
      </dd>
      <dt>Budget</dt>
      <dd>{formatGbp(rules.budgetPerPersonGbp)} per person</dd>
      <dt>Party</dt>
      <dd>
        {rules.partySize} {rules.partySize === 1 ? "traveller" : "travellers"}
        {partyDescription && `: ${partyDescription}`}
      </dd>
      {rules.partySize === 1 && (
        <>
          <dt>Cabin</dt>
          <dd>{SOLO_LABELS[rules.soloPreference]}</dd>
        </>
      )}
      <dt>Must-haves</dt>
      <dd>{mustHaves.length > 0 ? mustHaves.join(", ") : "None"}</dd>
      <dt>Preferences</dt>
      <dd>{softPreferences.length > 0 ? softPreferences.join("; ") : "None"}</dd>
    </dl>
  );
}

function MatchList({ matches }: { matches: Match[] }) {
  if (matches.length === 0) {
    return (
      <p className={styles.empty}>
        No new matches yet. Each night, departures that newly fit this brief are
        listed here.
      </p>
    );
  }
  return (
    <ul className={styles.list}>
      {matches.map(({ departure: d, status, fare, foundAt, seen }) => {
        const gone = status === "no_longer_available";
        return (
          <li key={d.departureId} className={gone ? `${styles.card} ${styles.gone}` : styles.card}>
            <p className={styles.cardTitle}>
              {d.voyageName}, {d.shipName}
              {gone && <span className={styles.goneLabel}>No longer available</span>}
              {!gone && !seen && <span className={styles.badge}>New</span>}
            </p>
            <p className={styles.facts}>
              <span>
                {formatDate(d.startDate)} to {formatDate(d.endDate)}
              </span>
              <span>
                {routeLabel(d.route)}, {d.nights} nights from {d.embarkPort}
              </span>
              {fare && (
                <span>
                  {fare.cabinName}, {formatGbp(fare.totalPerPersonGbp)} per person
                </span>
              )}
            </p>
            <p className={styles.facts}>
              <span>Found {formatTimestamp(foundAt)}</span>
              <span>Availability as of {formatTimestamp(d.availabilityUpdatedAt)}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
