import { describe, expect, it } from "vitest";
import type { Candidate, NearMiss } from "../db/search.ts";
import { fillPlaceholders, findPlaceholders, placeholderSources } from "./placeholders.ts";

const candidate: Candidate = {
  departureId: "dep_014",
  voyageName: "Classic Peninsula",
  route: "peninsula",
  nights: 10,
  embarkPort: "Ushuaia",
  shipName: "Petrel Star",
  passengerCapacity: 120,
  operatorName: "Southern Light Expeditions",
  startDate: "2026-12-05",
  endDate: "2026-12-15",
  availabilityUpdatedAt: "2026-11-01T09:00:00Z",
  fares: [
    {
      cabinCategoryId: "cab_petrel_twin",
      cabinName: "Twin with window",
      sleeps: 2,
      booking: "party",
      farePerPersonGbp: 9_200,
      totalPerPersonGbp: 9_995,
      berthsLeft: 4,
    },
  ],
};

const nearMiss: NearMiss = {
  ...candidate,
  departureId: "dep_067",
  shipName: "Skua",
  rule: "over_budget",
  distance: 400,
  fare: { ...candidate.fares[0], cabinName: "Suite", totalPerPersonGbp: 12_400 },
};

const sources = placeholderSources([{ candidate, fare: candidate.fares[0] }], [nearMiss]);

describe("findPlaceholders", () => {
  it("classifies departure fields, the sign-off and anything else", () => {
    expect(
      findPlaceholders(
        "{{departure:dep_014.price}} {{ specialist_name }} {{departure:dep_014.discount}} {{price}}",
      ),
    ).toEqual([
      { kind: "departure", raw: "{{departure:dep_014.price}}", departureId: "dep_014", field: "price" },
      { kind: "specialist_name", raw: "{{ specialist_name }}" },
      { kind: "invalid", raw: "{{departure:dep_014.discount}}" },
      { kind: "invalid", raw: "{{price}}" },
    ]);
  });

  it("flags stray braces", () => {
    expect(findPlaceholders("From {departure:dep_014.price} per person")).toEqual([
      { kind: "invalid", raw: "{departure:dep_014.price}" },
    ]);
  });

  it("finds nothing in plain prose", () => {
    expect(findPlaceholders("Warm wishes, and see you on the ice.")).toEqual([]);
  });
});

describe("fillPlaceholders", () => {
  it("fills every field from the database", () => {
    const email = [
      "{{departure:dep_014.ship}}",
      "{{departure:dep_014.voyage}}",
      "{{departure:dep_014.dates}}",
      "{{departure:dep_014.nights}}",
      "{{departure:dep_014.cabin}}",
      "{{departure:dep_014.price}}",
      "{{departure:dep_014.operator}}",
      "{{departure:dep_014.embark_port}}",
      "{{departure:dep_014.availability_as_of}}",
    ].join("|");

    expect(fillPlaceholders(email, sources).split("|")).toEqual([
      "Petrel Star",
      "Classic Peninsula",
      "5 Dec 2026 to 15 Dec 2026",
      "10 nights",
      "Twin with window",
      "£9,995 per person",
      "Southern Light Expeditions",
      "Ushuaia",
      "1 Nov 2026, 09:00 UTC",
    ]);
  });

  it("uses a near miss's closest fare", () => {
    expect(fillPlaceholders("{{departure:dep_067.ship}} in a {{departure:dep_067.cabin}} for {{departure:dep_067.price}}", sources)).toBe(
      "Skua in a Suite for £12,400 per person",
    );
  });

  it("leaves the sign-off for the UI", () => {
    expect(fillPlaceholders("Best wishes,\n{{specialist_name}}", sources)).toBe(
      "Best wishes,\n{{specialist_name}}",
    );
  });

  it("throws on a departure that isn't shown", () => {
    expect(() => fillPlaceholders("{{departure:dep_999.price}}", sources)).toThrow(/isn't shown/);
  });

  it("throws on an unknown field", () => {
    expect(() => fillPlaceholders("{{departure:dep_014.discount}}", sources)).toThrow(/Unknown placeholder/);
  });
});
