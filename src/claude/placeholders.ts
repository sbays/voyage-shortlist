import type { Candidate, FareOption, NearMiss } from "../db/search.ts";
import { formatDate, formatTimestamp } from "../lib/dates.ts";
import { formatGbp } from "../lib/money.ts";
import { PLACEHOLDER_FIELDS, type PlaceholderField } from "../domain/shortlist.ts";

// The email draft names facts only as placeholders, such as
// {{departure:dep_014.price}}. The server fills them from the database, so a
// price or date in the email can never be one the model wrote.

export const SPECIALIST_NAME = "{{specialist_name}}";

export type Placeholder =
  | { kind: "departure"; raw: string; departureId: string; field: PlaceholderField }
  | { kind: "specialist_name"; raw: string }
  | { kind: "invalid"; raw: string };

const BRACED = /\{\{([^{}]*)\}\}/g;
const DEPARTURE = /^departure:([A-Za-z0-9_]+)\.([a-z_]+)$/;

function isField(value: string): value is PlaceholderField {
  return (PLACEHOLDER_FIELDS as readonly string[]).includes(value);
}

/** Every {{...}} in the text, classified. Stray single braces are invalid too. */
export function findPlaceholders(text: string): Placeholder[] {
  const found: Placeholder[] = [];
  for (const match of text.matchAll(BRACED)) {
    const raw = match[0];
    const inner = match[1].trim();
    if (inner === "specialist_name") {
      found.push({ kind: "specialist_name", raw });
      continue;
    }
    const departure = DEPARTURE.exec(inner);
    if (departure && isField(departure[2])) {
      found.push({ kind: "departure", raw, departureId: departure[1], field: departure[2] });
    } else {
      found.push({ kind: "invalid", raw });
    }
  }
  // Anything brace-like left over after removing well-formed {{...}} is malformed.
  const leftover = text.replace(BRACED, "");
  for (const stray of leftover.match(/[{}]+[^{}\s]*[{}]*/g) ?? []) {
    found.push({ kind: "invalid", raw: stray });
  }
  return found;
}

/** The facts a placeholder can be filled from: one departure and its chosen fare. */
export interface PlaceholderSource {
  departure: Candidate | NearMiss;
  fare: FareOption;
}

function render(field: PlaceholderField, { departure, fare }: PlaceholderSource): string {
  switch (field) {
    case "ship":
      return departure.shipName;
    case "voyage":
      return departure.voyageName;
    case "dates":
      return `${formatDate(departure.startDate)} to ${formatDate(departure.endDate)}`;
    case "nights":
      return `${departure.nights} nights`;
    case "cabin":
      return fare.cabinName;
    case "price":
      return `${formatGbp(fare.totalPerPersonGbp)} per person`;
    case "operator":
      return departure.operatorName;
    case "embark_port":
      return departure.embarkPort;
    case "availability_as_of":
      return formatTimestamp(departure.availabilityUpdatedAt);
  }
}

/**
 * Replaces every departure placeholder with database values. Leaves
 * {{specialist_name}} for the UI, which fills it from the "Your name" field.
 * Throws on anything it can't fill: ranking validation should have caught it.
 */
export function fillPlaceholders(
  email: string,
  sources: ReadonlyMap<string, PlaceholderSource>,
): string {
  for (const placeholder of findPlaceholders(email)) {
    if (placeholder.kind === "invalid") {
      throw new Error(`Unknown placeholder in email: ${placeholder.raw}`);
    }
    if (placeholder.kind === "departure" && !sources.has(placeholder.departureId)) {
      throw new Error(`Placeholder names a departure that isn't shown: ${placeholder.raw}`);
    }
  }
  return email.replace(BRACED, (raw, inner: string) => {
    const departure = DEPARTURE.exec(inner.trim());
    if (!departure || !isField(departure[2])) return raw; // {{specialist_name}}
    const source = sources.get(departure[1]);
    return source ? render(departure[2], source) : raw;
  });
}

/** Picks and near misses keyed by departure ID, for fillPlaceholders. */
export function placeholderSources(
  picks: readonly { candidate: Candidate; fare: FareOption }[],
  nearMisses: readonly NearMiss[],
): Map<string, PlaceholderSource> {
  const sources = new Map<string, PlaceholderSource>();
  for (const nearMiss of nearMisses) {
    sources.set(nearMiss.departureId, { departure: nearMiss, fare: nearMiss.fare });
  }
  for (const pick of picks) {
    sources.set(pick.candidate.departureId, { departure: pick.candidate, fare: pick.fare });
  }
  return sources;
}
