"use client";

import { useSyncExternalStore } from "react";
import type { ShortlistResult } from "../action-types";
import { readName, subscribeName } from "../brief/specialist-name";
import type { FareOption } from "@/db/search";
import type { ShortlistPick } from "@/domain/shortlist";
import { formatDate } from "@/lib/dates";
import { formatGbp } from "@/lib/money";
import { routeLabel } from "@/lib/routes";
import { EmailDraft } from "./email-draft";
import { Heading, headingTag, type HeadingTag } from "./heading";
import {
  availabilityLine,
  bookingText,
  exclusionHeadline,
  exclusionLine,
  exclusionSuggestion,
  nearMissText,
  plural,
  unrankedNotice,
} from "./format";
import { SaveBrief } from "./save-brief";
import styles from "./shortlist.module.css";

// Renders a checked shortlist, on the home page after a run and on a saved
// brief's page. Every price, date, ship and availability figure comes from
// the database rows in `result`; Claude's text appears only as labelled
// reasons, trade-offs and notes.

export interface ShortlistViewProps {
  result: ShortlistResult;
  /**
   * From the brief form's "Your name" field; fills {{specialist_name}}.
   * When empty, the name remembered in this browser is used instead.
   */
  specialistName: string;
  /** The shortlist title's level; its sections sit one level below. Default 2. */
  headingLevel?: 2 | 3;
}


const dates = (start: string, end: string) => `${formatDate(start)} to ${formatDate(end)}`;

function Price({ fare, withActivities }: { fare: FareOption; withActivities: boolean }) {
  const includesActivities = withActivities && fare.totalPerPersonGbp > fare.farePerPersonGbp;
  return (
    <>
      {formatGbp(fare.totalPerPersonGbp)} per person
      {includesActivities && (
        <span className={styles.detail}>
          includes must-have activities ({formatGbp(fare.farePerPersonGbp)} fare)
        </span>
      )}
    </>
  );
}

interface PickCardProps {
  pick: ShortlistPick;
  withActivities: boolean;
  cardTag: HeadingTag;
}

function PickCard({ pick, withActivities, cardTag }: PickCardProps) {
  const { candidate: c, fare } = pick;
  return (
    <li className={styles.card}>
      <p className={styles.rank}>Pick {pick.rank}</p>
      <Heading tag={cardTag} className={styles.cardTitle}>
        {c.voyageName}
      </Heading>
      <dl className={styles.facts}>
        <div>
          <dt>Dates</dt>
          <dd>
            {dates(c.startDate, c.endDate)}, {c.nights} nights
          </dd>
        </div>
        <div>
          <dt>Ship</dt>
          <dd>
            {c.shipName}, {c.operatorName}
            <span className={styles.detail}>{c.passengerCapacity} passengers</span>
          </dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>
            {routeLabel(c.route)} from {c.embarkPort}
          </dd>
        </div>
        <div>
          <dt>Cabin</dt>
          <dd>
            {fare.cabinName}
            <span className={styles.detail}>{bookingText(fare.booking)}</span>
          </dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>
            <Price fare={fare} withActivities={withActivities} />
          </dd>
        </div>
        <div>
          <dt>Berths left</dt>
          <dd>{fare.berthsLeft}</dd>
        </div>
      </dl>
      <div className={styles.reasoning}>
        <p className={styles.reasoningLabel}>Claude&apos;s reasoning</p>
        <p>
          <strong>Why it fits:</strong> {pick.reason}
        </p>
        <p>
          <strong>Trade-off:</strong> {pick.tradeOff}
        </p>
      </div>
      <p className={styles.detail}>{c.departureId}</p>
    </li>
  );
}

function ComparisonTable({ picks, withActivities }: { picks: ShortlistPick[]; withActivities: boolean }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className={styles.caption}>The picks side by side, from the database.</caption>
        <thead>
          <tr>
            <th scope="col">Pick</th>
            <th scope="col">Dates</th>
            <th scope="col">Voyage</th>
            <th scope="col">Ship</th>
            <th scope="col">Cabin</th>
            <th scope="col" className={styles.number}>
              Per person
            </th>
            <th scope="col" className={styles.number}>
              Berths left
            </th>
          </tr>
        </thead>
        <tbody>
          {picks.map(({ rank, candidate: c, fare }) => (
            <tr key={c.departureId}>
              <th scope="row">{rank}</th>
              <td>
                {dates(c.startDate, c.endDate)}
                <span className={styles.detail}>{c.nights} nights</span>
              </td>
              <td>
                {c.voyageName}
                <span className={styles.detail}>
                  {routeLabel(c.route)} from {c.embarkPort}
                </span>
              </td>
              <td>
                {c.shipName}
                <span className={styles.detail}>
                  {c.operatorName}, {c.passengerCapacity} passengers
                </span>
              </td>
              <td>{fare.cabinName}</td>
              <td className={styles.number}>
                <Price fare={fare} withActivities={withActivities} />
              </td>
              <td className={styles.number}>{fare.berthsLeft}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ShortlistView({ result, specialistName, headingLevel = 2 }: ShortlistViewProps) {
  const { shortlist, exclusions, brief } = result;
  // The server render has no storage, so it starts from "" and the remembered
  // name arrives on hydration without a mismatch.
  const rememberedName = useSyncExternalStore(subscribeName, () => readName(), () => "");
  const name = specialistName.trim() || rememberedName;
  const titleTag = headingTag(headingLevel, 0);
  const sectionTag = headingTag(headingLevel, 1);
  const availability = availabilityLine(result.availabilityAsOf);
  const { picks, nearMisses } = shortlist;
  const withActivities = brief.rules.mustHaveActivityIds.length > 0;
  const nothingClose = picks.length === 0 && nearMisses.length === 0;
  const unranked = unrankedNotice(shortlist.unrankedCount);

  return (
    <article className={styles.shortlist} aria-labelledby="shortlist-heading">
      <Heading tag={titleTag} id="shortlist-heading" className={styles.title}>
        Shortlist
      </Heading>
      {availability && (
        <p className={styles.availability}>
          <strong>{availability}</strong>
          <span className={styles.detail}>
            Availability changes quickly. Confirm with the operator before placing any hold.
          </span>
        </p>
      )}

      {unranked && (
        <p className={styles.notice} role="note">
          {unranked}
        </p>
      )}

      {nothingClose && (
        <section className={styles.section} aria-labelledby="nothing-fits-heading">
          <Heading tag={sectionTag} id="nothing-fits-heading" className={styles.heading}>
            {exclusionHeadline(exclusions)}
          </Heading>
          {exclusions.length > 0 && (
            <>
              <p className={styles.muted}>Departures ruled out by each rule (many break more than one):</p>
              <ul className={styles.list}>
                {exclusions.slice(0, 4).map((e) => (
                  <li key={e.rule}>{exclusionLine(e)}</li>
                ))}
              </ul>
            </>
          )}
          <p>{exclusionSuggestion(exclusions) ?? "Try relaxing the dates or the budget."}</p>
        </section>
      )}

      {picks.length > 0 && (
        <section className={styles.section} aria-labelledby="picks-heading">
          <Heading tag={sectionTag} id="picks-heading" className={styles.heading}>
            Top {picks.length === 1 ? "pick" : `${picks.length} picks`}
          </Heading>
          <ol className={styles.cards}>
            {picks.map((pick) => (
              <PickCard
                key={pick.candidate.departureId}
                pick={pick}
                withActivities={withActivities}
                cardTag={headingTag(headingLevel, 2)}
              />
            ))}
          </ol>
          <ComparisonTable picks={picks} withActivities={withActivities} />
        </section>
      )}

      {picks.length === 0 && nearMisses.length > 0 && (
        <p className={styles.notice} role="note">
          Nothing fits the brief exactly. These departures each miss by one rule, and the draft email
          explains what it would take.
        </p>
      )}

      {nearMisses.length > 0 && (
        <section className={styles.section} aria-labelledby="near-misses-heading">
          <Heading tag={sectionTag} id="near-misses-heading" className={styles.heading}>
            Near misses
          </Heading>
          <p className={styles.muted}>Each breaks exactly one rule of the brief.</p>
          <ul className={styles.nearMisses}>
            {nearMisses.map(({ nearMiss: n, note }) => (
              <li key={n.departureId} className={styles.nearMiss}>
                <p className={styles.missRule}>{nearMissText(n)}</p>
                <p>
                  <strong>{n.voyageName}</strong>, {n.shipName} ({n.operatorName})
                </p>
                <p className={styles.muted}>
                  {dates(n.startDate, n.endDate)}, {n.nights} nights.{" "}
                  {n.fare.cabinName}, {plural(n.fare.berthsLeft, "berth", "berths")} left:{" "}
                  <Price fare={n.fare} withActivities={withActivities} />
                </p>
                {note && (
                  <p className={styles.note}>
                    <span className={styles.reasoningLabel}>Claude&apos;s note</span> {note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {shortlist.emailBody.trim() !== "" && (
        // Keyed by brief so a new shortlist resets the draft; the prefixes
        // keep the two keyed siblings distinct.
        <EmailDraft
          key={`email-${result.briefId}`}
          emailBody={shortlist.emailBody}
          specialistName={name}
          headingTag={sectionTag}
        />
      )}

      {result.briefId && <SaveBrief key={`save-${result.briefId}`} briefId={result.briefId} saved={result.saved} />}
    </article>
  );
}
