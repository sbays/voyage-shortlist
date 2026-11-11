import { describe, expect, it } from "vitest";
import { MAX_RANKED_CANDIDATES } from "@/domain/limits";
import {
  availabilityLine,
  bookingText,
  exclusionHeadline,
  exclusionLine,
  exclusionSuggestion,
  fillSpecialistName,
  NAME_FALLBACK,
  nearMissText,
  unrankedNotice,
} from "./format";

describe("nearMissText", () => {
  it("states each rule in its own unit", () => {
    expect(nearMissText({ rule: "over_budget", distance: 450 })).toBe("£450 per person over budget");
    expect(nearMissText({ rule: "outside_window", distance: 3 })).toBe("3 days outside the date window");
    expect(nearMissText({ rule: "outside_window", distance: 1 })).toBe("1 day outside the date window");
    expect(nearMissText({ rule: "berths_short", distance: 2 })).toBe("2 berths short");
    expect(nearMissText({ rule: "activity_places_short", distance: 1 })).toBe("1 activity place short");
    expect(
      nearMissText({ rule: "activity_places_short", distance: 1, shortActivity: "Sea kayaking" }),
    ).toBe("1 sea kayaking place short");
    expect(
      nearMissText({ rule: "activity_places_short", distance: 3, shortActivity: "Overnight camping" }),
    ).toBe("3 overnight camping places short");
    expect(nearMissText({ rule: "no_solo_price", distance: 0 })).toBe(
      "No solo price for a cabin of their own; sharing fits",
    );
  });
});

describe("exclusions", () => {
  const counts = [
    { rule: "over_budget" as const, departures: 83 },
    { rule: "outside_window" as const, departures: 40 },
    { rule: "activity_not_offered" as const, departures: 12 },
  ];

  it("names the rule that excluded the most", () => {
    expect(exclusionHeadline(counts)).toBe("Nothing fits. The budget ruled out the most departures (83).");
  });

  it("still says something with no counts", () => {
    expect(exclusionHeadline([])).toBe("Nothing fits this brief, and nothing comes close.");
    expect(exclusionSuggestion([])).toBeNull();
  });

  it("suggests relaxing the top two", () => {
    expect(exclusionSuggestion(counts)).toBe("Try raising the budget, or widening the dates.");
  });

  it("lists a count", () => {
    expect(exclusionLine(counts[2])).toBe("the must-have activities not being offered: 12 departures");
  });
});

describe("fillSpecialistName", () => {
  it("fills every sign-off placeholder", () => {
    expect(fillSpecialistName("Hi\n{{specialist_name}}\n{{specialist_name}}", " Sam ")).toBe("Hi\nSam\nSam");
  });

  it("leaves a visible gap when the name is blank", () => {
    expect(fillSpecialistName("Best,\n{{specialist_name}}", "  ")).toBe(`Best,\n${NAME_FALLBACK}`);
  });
});

describe("other lines", () => {
  it("shows availability, or says there is none", () => {
    expect(availabilityLine("2026-11-01T09:00:00Z")).toBe("Availability as of 1 Nov 2026, 09:00 UTC");
    expect(availabilityLine(null)).toBeNull();
  });

  it("explains unranked candidates only when there are some", () => {
    expect(unrankedNotice(0)).toBeNull();
    expect(unrankedNotice(1)).toMatch(/^1 more departure also fit but wasn't ranked/);
    expect(unrankedNotice(5)).toMatch(/^5 more departures also fit but weren't ranked: only the 20 earliest/);
    expect(unrankedNotice(5)).toContain(`only the ${MAX_RANKED_CANDIDATES} earliest`);
  });

  it("describes each booking", () => {
    expect(bookingText("own_cabin")).toMatch(/solo price/);
  });
});
