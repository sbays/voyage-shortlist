import type { Booking, ExclusionCount, ExclusionRule, NearMiss } from "@/db/search";
import { MAX_RANKED_CANDIDATES } from "@/domain/limits";
import { SPECIALIST_NAME } from "@/domain/specialist-name";
import { formatTimestamp } from "@/lib/dates";
import { formatGbp } from "@/lib/money";

// Plain-text formatting for the shortlist view. Every fact here comes from
// database fields on Candidate, NearMiss and ExclusionCount, never from
// model text.

export const NAME_FALLBACK = "[your name]";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a near miss would take, in the rule's own unit. */
export function nearMissText(
  nearMiss: Pick<NearMiss, "rule" | "distance" | "shortActivity">,
): string {
  const { rule, distance, shortActivity } = nearMiss;
  switch (rule) {
    case "over_budget":
      return `${formatGbp(distance)} per person over budget`;
    case "outside_window":
      return `${plural(distance, "day", "days")} outside the date window`;
    case "berths_short":
      return `${plural(distance, "berth", "berths")} short`;
    case "activity_places_short":
      // "1 sea kayaking place short", from the activity's catalogue name.
      if (shortActivity) {
        const activity = shortActivity.charAt(0).toLowerCase() + shortActivity.slice(1);
        return `${plural(distance, `${activity} place`, `${activity} places`)} short`;
      }
      return `${plural(distance, "activity place", "activity places")} short`;
    case "no_solo_price":
      return "No solo price for a cabin of their own; sharing fits";
  }
}

const EXCLUSION_LABELS: Record<ExclusionRule, { label: string; relax: string }> = {
  over_budget: { label: "the budget", relax: "raising the budget" },
  outside_window: { label: "the date window", relax: "widening the dates" },
  berths_short: { label: "berths for the party", relax: "a smaller party or other cabins" },
  activity_places_short: {
    label: "places left on the must-have activities",
    relax: "making an activity a preference rather than a must-have",
  },
  no_solo_price: { label: "the lack of a solo price", relax: "sharing a cabin" },
  activity_not_offered: {
    label: "the must-have activities not being offered",
    relax: "dropping a must-have activity",
  },
};

export function exclusionLabel(rule: ExclusionRule): string {
  return EXCLUSION_LABELS[rule].label;
}

/** "Nothing fits. The budget ruled out the most departures (83)." */
export function exclusionHeadline(exclusions: ExclusionCount[]): string {
  const [top] = exclusions;
  if (!top) return "Nothing fits this brief, and nothing comes close.";
  const label = exclusionLabel(top.rule);
  return `Nothing fits. ${label[0].toUpperCase()}${label.slice(1)} ruled out the most departures (${top.departures}).`;
}

/** The suggestion for the top few exclusions, in order. */
export function exclusionSuggestion(exclusions: ExclusionCount[], max = 2): string | null {
  const relax = exclusions.slice(0, max).map((e) => EXCLUSION_LABELS[e.rule].relax);
  if (relax.length === 0) return null;
  return `Try ${relax.join(", or ")}.`;
}

export function exclusionLine(count: ExclusionCount): string {
  return `${exclusionLabel(count.rule)}: ${plural(count.departures, "departure", "departures")}`;
}

/** Fills the sign-off placeholder; a blank name leaves a visible gap to fill. */
export function fillSpecialistName(emailBody: string, specialistName: string): string {
  const name = specialistName.trim() || NAME_FALLBACK;
  return emailBody.split(SPECIALIST_NAME).join(name);
}

/** Null when no departure is shown, so there is no availability to report. */
export function availabilityLine(availabilityAsOf: string | null): string | null {
  return availabilityAsOf === null ? null : `Availability as of ${formatTimestamp(availabilityAsOf)}`;
}

export function unrankedNotice(unrankedCount: number): string | null {
  if (unrankedCount <= 0) return null;
  return `${plural(unrankedCount, "more departure", "more departures")} also fit but ${unrankedCount === 1 ? "wasn't" : "weren't"} ranked: only the ${MAX_RANKED_CANDIDATES} earliest are. Narrow the dates or budget to rank the rest.`;
}

export function bookingText(booking: Booking): string {
  switch (booking) {
    case "party":
      return "Whole party in this category";
    case "shared":
      return "Sharing with another traveller";
    case "own_cabin":
      return "Cabin to themselves (solo price)";
  }
}
