import type { HardRules } from "../domain/brief.ts";
import type { Db } from "./db.ts";

// SQL decides what's possible. One query scores every way the party could
// book every fare against each hard rule; this module then splits the rows
// into candidates (nothing broken) and near misses (exactly one rule broken).

/** How the party would occupy the cabin. Solo travellers either share or pay the solo price. */
export type Booking = "party" | "shared" | "own_cabin";

export type NearMissRule =
  | "over_budget"
  | "outside_window"
  | "berths_short"
  | "activity_places_short"
  | "no_solo_price";

export interface DepartureSummary {
  departureId: string;
  voyageName: string;
  route: string;
  nights: number;
  embarkPort: string;
  shipName: string;
  passengerCapacity: number;
  operatorName: string;
  startDate: string;
  endDate: string;
  availabilityUpdatedAt: string;
}

export interface FareOption {
  cabinCategoryId: string;
  cabinName: string;
  sleeps: number;
  booking: Booking;
  farePerPersonGbp: number;
  /** Fare plus every must-have activity: what the budget is compared with. */
  totalPerPersonGbp: number;
  berthsLeft: number;
}

export interface Candidate extends DepartureSummary {
  /** Every fare that meets the hard rules, cheapest first. */
  fares: FareOption[];
}

export interface NearMiss extends DepartureSummary {
  rule: NearMissRule;
  /**
   * How far it misses, in the rule's own unit: pounds over, days outside,
   * berths or places short. 0 for `no_solo_price`.
   */
  distance: number;
  /** The closest fare: the one that breaks only this rule. */
  fare: FareOption;
}

export interface SearchResult {
  candidates: Candidate[];
  nearMisses: NearMiss[];
}

export const NEAR_MISSES_PER_RULE = 2;
export const MAX_NEAR_MISSES = 6;

/** The order near misses of equal rank are listed in. */
const RULE_ORDER: NearMissRule[] = [
  "over_budget",
  "outside_window",
  "berths_short",
  "activity_places_short",
  "no_solo_price",
];

interface ScoredRow {
  departure_id: string;
  voyage_name: string;
  route: string;
  nights: number;
  embark_port: string;
  ship_name: string;
  passenger_capacity: number;
  operator_name: string;
  start_date: string;
  end_date: string;
  availability_updated_at: string;
  cabin_category_id: string;
  cabin_name: string;
  sleeps: number;
  booking: Booking;
  fare_pp: number;
  total_pp: number;
  berths_left: number;
  over_budget: number;
  days_outside: number;
  berths_short: number;
  places_short: number;
  solo_missing: boolean;
  [key: string]: unknown;
}

// Rows breaking two or more rules are dropped in SQL. Departures that don't
// offer every must-have activity at all are excluded, not near misses: only a
// shortage of places on an offered activity counts as close.
const SCORE_SQL = `
WITH params AS (
  SELECT $1::date AS ws, $2::date AS we, $3::int AS budget, $4::int AS party,
         $5::text AS solo,
         -- Distinct, so a repeated ID can't demand more activities than exist.
         ARRAY(SELECT DISTINCT unnest($6::text[])) AS acts
),
must AS (
  SELECT d.id AS departure_id,
         count(da.activity_id)::int AS offered,
         coalesce(sum(da.price_gbp), 0)::int AS activity_pp,
         greatest(coalesce(max(p.party - da.places_left), 0), 0)::int AS places_short
  FROM departures d
  CROSS JOIN params p
  LEFT JOIN departure_activities da
    ON da.departure_id = d.id AND da.activity_id = ANY (p.acts)
  GROUP BY d.id
),
options AS (
  -- A party of two or more: everyone in the one category at the per-person fare.
  SELECT f.departure_id, f.cabin_category_id, 'party' AS booking,
         f.price_gbp_pp AS fare_pp, p.party AS berths_needed, false AS solo_missing
  FROM departure_fares f CROSS JOIN params p
  WHERE p.party > 1
  UNION ALL
  -- Alone, sharing a cabin that sleeps two or more with another traveller.
  SELECT f.departure_id, f.cabin_category_id, 'shared',
         f.price_gbp_pp, 1, false
  FROM departure_fares f
  JOIN cabin_categories c ON c.id = f.cabin_category_id
  CROSS JOIN params p
  WHERE p.party = 1 AND p.solo IN ('will_share', 'either') AND c.sleeps >= 2
  UNION ALL
  -- Alone, with the cabin to themselves at the solo price. berths_left
  -- counts beds, and a private cabin takes every bed in it.
  SELECT f.departure_id, f.cabin_category_id, 'own_cabin',
         f.solo_price_gbp, c.sleeps, false
  FROM departure_fares f
  JOIN cabin_categories c ON c.id = f.cabin_category_id
  CROSS JOIN params p
  WHERE p.party = 1 AND p.solo IN ('own_cabin', 'either') AND f.solo_price_gbp IS NOT NULL
  UNION ALL
  -- Wants their own cabin but this fare has no solo price: close only if
  -- sharing would otherwise fit, so it is priced as sharing.
  SELECT f.departure_id, f.cabin_category_id, 'shared',
         f.price_gbp_pp, 1, true
  FROM departure_fares f
  JOIN cabin_categories c ON c.id = f.cabin_category_id
  CROSS JOIN params p
  WHERE p.party = 1 AND p.solo = 'own_cabin' AND f.solo_price_gbp IS NULL AND c.sleeps >= 2
),
scored AS (
  SELECT o.departure_id, o.cabin_category_id, o.booking, o.fare_pp, o.solo_missing,
         f.berths_left,
         o.fare_pp + m.activity_pp AS total_pp,
         greatest(o.fare_pp + m.activity_pp - p.budget, 0) AS over_budget,
         greatest(p.ws - d.start_date, d.end_date - p.we, 0) AS days_outside,
         greatest(o.berths_needed - f.berths_left, 0) AS berths_short,
         m.places_short
  FROM options o
  JOIN departure_fares f
    ON f.departure_id = o.departure_id AND f.cabin_category_id = o.cabin_category_id
  JOIN departures d ON d.id = o.departure_id
  JOIN must m ON m.departure_id = o.departure_id
  CROSS JOIN params p
  WHERE m.offered = cardinality(p.acts)
)
SELECT s.departure_id, v.name AS voyage_name, v.route::text AS route, v.nights,
       v.embark_port, sh.name AS ship_name, sh.passenger_capacity,
       op.name AS operator_name,
       d.start_date::text AS start_date, d.end_date::text AS end_date,
       to_char(d.availability_updated_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS availability_updated_at,
       s.cabin_category_id, c.name AS cabin_name, c.sleeps, s.booking,
       s.fare_pp, s.total_pp, s.berths_left,
       s.over_budget, s.days_outside, s.berths_short, s.places_short, s.solo_missing
FROM scored s
JOIN departures d ON d.id = s.departure_id
JOIN voyages v ON v.id = d.voyage_id
JOIN ships sh ON sh.id = v.ship_id
JOIN operators op ON op.id = sh.operator_id
JOIN cabin_categories c ON c.id = s.cabin_category_id
WHERE (s.over_budget > 0)::int + (s.days_outside > 0)::int + (s.berths_short > 0)::int
    + (s.places_short > 0)::int + s.solo_missing::int <= 1
ORDER BY d.start_date, s.departure_id, s.total_pp, s.cabin_category_id, s.booking
`;

function brokenRule(row: ScoredRow): NearMissRule | null {
  if (row.over_budget > 0) return "over_budget";
  if (row.days_outside > 0) return "outside_window";
  if (row.berths_short > 0) return "berths_short";
  if (row.places_short > 0) return "activity_places_short";
  if (row.solo_missing) return "no_solo_price";
  return null;
}

function distanceFor(row: ScoredRow, rule: NearMissRule): number {
  switch (rule) {
    case "over_budget":
      return row.over_budget;
    case "outside_window":
      return row.days_outside;
    case "berths_short":
      return row.berths_short;
    case "activity_places_short":
      return row.places_short;
    case "no_solo_price":
      return 0;
  }
}

function summary(row: ScoredRow): DepartureSummary {
  return {
    departureId: row.departure_id,
    voyageName: row.voyage_name,
    route: row.route,
    nights: row.nights,
    embarkPort: row.embark_port,
    shipName: row.ship_name,
    passengerCapacity: row.passenger_capacity,
    operatorName: row.operator_name,
    startDate: row.start_date,
    endDate: row.end_date,
    availabilityUpdatedAt: row.availability_updated_at,
  };
}

function fare(row: ScoredRow): FareOption {
  return {
    cabinCategoryId: row.cabin_category_id,
    cabinName: row.cabin_name,
    sleeps: row.sleeps,
    booking: row.booking,
    farePerPersonGbp: row.fare_pp,
    totalPerPersonGbp: row.total_pp,
    berthsLeft: row.berths_left,
  };
}

/**
 * Candidates (in start-date order) and the closest near misses for a brief.
 */
export async function searchDepartures(db: Db, rules: HardRules): Promise<SearchResult> {
  const rows = await db.query<ScoredRow>(SCORE_SQL, [
    rules.windowStart,
    rules.windowEnd,
    rules.budgetPerPersonGbp,
    rules.partySize,
    rules.soloPreference,
    rules.mustHaveActivityIds,
  ]);

  const candidates = new Map<string, Candidate>();
  for (const row of rows) {
    if (brokenRule(row) !== null) continue;
    const candidate = candidates.get(row.departure_id) ?? { ...summary(row), fares: [] };
    // "Either" can qualify a fare twice, shared and own cabin: the cheaper counts.
    const existing = candidate.fares.find((f) => f.cabinCategoryId === row.cabin_category_id);
    if (!existing) candidate.fares.push(fare(row));
    else if (row.total_pp < existing.totalPerPersonGbp) Object.assign(existing, fare(row));
    candidates.set(row.departure_id, candidate);
  }
  for (const candidate of candidates.values()) {
    candidate.fares.sort(
      (a, b) =>
        a.totalPerPersonGbp - b.totalPerPersonGbp ||
        a.cabinCategoryId.localeCompare(b.cabinCategoryId),
    );
  }

  return { candidates: [...candidates.values()], nearMisses: pickNearMisses(rows, candidates) };
}

function pickNearMisses(rows: ScoredRow[], candidates: Map<string, Candidate>): NearMiss[] {
  // The closest fare per departure and rule.
  const closest = new Map<string, NearMiss>();
  for (const row of rows) {
    const rule = brokenRule(row);
    if (rule === null || candidates.has(row.departure_id)) continue;
    const distance = distanceFor(row, rule);
    const key = `${row.departure_id}|${rule}`;
    const current = closest.get(key);
    if (
      !current ||
      distance < current.distance ||
      (distance === current.distance && row.total_pp < current.fare.totalPerPersonGbp)
    ) {
      closest.set(key, { ...summary(row), rule, distance, fare: fare(row) });
    }
  }

  // Rank each rule's near misses only against their own kind.
  const byRule = new Map<NearMissRule, NearMiss[]>();
  for (const nearMiss of closest.values()) {
    const list = byRule.get(nearMiss.rule) ?? [];
    list.push(nearMiss);
    byRule.set(nearMiss.rule, list);
  }
  for (const list of byRule.values()) {
    list.sort(
      (a, b) =>
        a.distance - b.distance ||
        a.fare.totalPerPersonGbp - b.fare.totalPerPersonGbp ||
        a.startDate.localeCompare(b.startDate) ||
        a.departureId.localeCompare(b.departureId),
    );
  }

  // Take each rule's closest, then each rule's second closest, and so on.
  // A departure appears once, under the first rule that reaches it.
  const picked: NearMiss[] = [];
  const seen = new Set<string>();
  const cursor = new Map<NearMissRule, number>();
  const perRule = new Map<NearMissRule, number>();
  let progressed = true;
  while (picked.length < MAX_NEAR_MISSES && progressed) {
    progressed = false;
    for (const rule of RULE_ORDER) {
      if (picked.length >= MAX_NEAR_MISSES) break;
      if ((perRule.get(rule) ?? 0) >= NEAR_MISSES_PER_RULE) continue;
      const list = byRule.get(rule) ?? [];
      let i = cursor.get(rule) ?? 0;
      while (i < list.length && seen.has(list[i].departureId)) i++;
      if (i < list.length) {
        picked.push(list[i]);
        seen.add(list[i].departureId);
        perRule.set(rule, (perRule.get(rule) ?? 0) + 1);
        progressed = true;
        i++;
      }
      cursor.set(rule, i);
    }
  }
  return picked;
}
