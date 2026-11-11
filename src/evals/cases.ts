import type { HardRules } from "../domain/brief.ts";

// The evaluation set: 10 invented briefs, each with the departure a good
// specialist would put first. `rules` is what the specialist confirms on the
// form, so ranking is scored on those, not on what extraction made of the
// notes. Every case has at least 3 candidates, and the expected pick wins on
// soft fit rather than by being the only option (see cases.test.ts).
// Names are invented first names only. No real personal data.

export interface EvalCase {
  id: string;
  /** Rough notes from a call, as a specialist would type them. */
  notes: string;
  rules: HardRules;
  partyDescription: string;
  softPreferences: string[];
  /** The departure a good specialist would rank first. */
  expectedTop: string;
  /** The candidate that makes this a real test, and why it should lose. */
  competitor: string;
  why: string;
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "seasick-fly-cruise",
    notes: `Call w/ Priya + husband Dev. Both terrible sailors, she was sick on the Isle of Wight ferry (!!). Dreading the Drake. Dev can only get ~10 days off mid Jan, back at work 29th. Budget up to 12,300 pp, firm. Want penguins obviously, not fussed about ship luxury.`,
    rules: {
      windowStart: "2027-01-12",
      windowEnd: "2027-01-28",
      budgetPerPersonGbp: 12_300,
      partySize: 2,
      soloPreference: "either",
      mustHaveActivityIds: [],
    },
    partyDescription: "Couple, both prone to seasickness",
    softPreferences: ["very worried about seasickness", "short on time", "wants penguins"],
    expectedTop: "dep_061",
    competitor: "dep_059 (cheaper 10-night sailing on a small ship, but crosses the Drake both ways)",
    why: "The only fly-cruise in budget, so they skip the Drake Passage they're dreading and fit the short leave.",
  },
  {
    id: "whales-late-season",
    notes: `Margaret & Ken, retired, done the peninsula before in Dec 2019, this time it's ALL about whales. Happy to go late, Feb into early March fine, home by 12 Mar. Budget 8300 pp tops. Ken has a long lens, wants time on deck. Smaller ship pref.`,
    rules: {
      windowStart: "2027-02-01",
      windowEnd: "2027-03-12",
      budgetPerPersonGbp: 8_300,
      partySize: 2,
      soloPreference: "either",
      mustHaveActivityIds: [],
    },
    partyDescription: "Retired couple, second Antarctic trip",
    softPreferences: ["whales are the priority", "keen photographer", "prefers a smaller ship"],
    expectedTop: "dep_082",
    competitor: "dep_075 (cheapest and smallest, but early February, before the whale peak)",
    why: "Late season is the best time for whales, and this is the latest sailing that fits, on a small ship.",
  },
  {
    id: "chicks-mid-season",
    notes: `Sophie + partner Tom. Sophie obsessed w/ penguin chicks, wants to see them properly, "fluffy stage". Flexible Dec to end Feb. Budget around 8300 pp max. Don't want a huge ship, want to actually land every day if poss.`,
    rules: {
      windowStart: "2026-12-01",
      windowEnd: "2027-02-28",
      budgetPerPersonGbp: 8_300,
      partySize: 2,
      soloPreference: "either",
      mustHaveActivityIds: [],
    },
    partyDescription: "Couple, wildlife lovers",
    softPreferences: ["wants to see penguin chicks", "no big ships", "wants landings every day"],
    expectedTop: "dep_065",
    competitor: "dep_034 (same small ship, but mid-December, before the chicks hatch)",
    why: "Mid to late January is peak chick season, and this small ship can land every day.",
  },
  {
    id: "landings-not-big-ship",
    notes: `Owen + Beth, active, hikers, want max time ashore. Over New Year, home by 16 Jan. Budget 11k pp. Owen asked about the cheap big ship he saw advertised, explained landing limits, they still want landings over price. 10ish days fine.`,
    rules: {
      windowStart: "2026-12-26",
      windowEnd: "2027-01-16",
      budgetPerPersonGbp: 11_000,
      partySize: 2,
      soloPreference: "either",
      mustHaveActivityIds: [],
    },
    partyDescription: "Active couple who hike",
    softPreferences: ["as much time ashore as possible", "landings matter more than price", "about 10 days"],
    expectedTop: "dep_053",
    competitor: "dep_056 (less than half the price, but a 920-passenger ship that can't land)",
    why: "The smallest ship in the window gets the most time ashore, which they value above price.",
  },
  {
    id: "solo-own-cabin",
    notes: `Helen, travelling alone, 50s, definitely wants own cabin, won't share. Late Nov to mid Dec. Budget 13k all in. Wants a proper expedition feel, zodiac landings, lectures. Not a cruise-ship person.`,
    rules: {
      // The prompt reads "late Nov" as from the 20th. This case keeps the 15th:
      // the expected pick sails before the 20th, so the specialist widens it.
      windowStart: "2026-11-15",
      windowEnd: "2026-12-15",
      budgetPerPersonGbp: 13_000,
      partySize: 1,
      soloPreference: "own_cabin",
      mustHaveActivityIds: [],
    },
    partyDescription: "Solo traveller in her 50s",
    softPreferences: ["proper expedition feel", "zodiac landings", "not a cruise-ship person"],
    expectedTop: "dep_016",
    competitor: "dep_015 (own cabin for much less, but on the 920-passenger ship with no landings)",
    why: "The only small expedition ship with a single cabin she can afford, where the cheaper options are a ship that can't land.",
  },
  {
    id: "solo-will-share",
    notes: `Raj, solo, early 30s, happy to share a cabin to save money. Budget firm at 8500. Late Jan to mid March window. Would love chicks if still around, likes small groups, the smaller the better.`,
    rules: {
      windowStart: "2027-01-20",
      windowEnd: "2027-03-15",
      budgetPerPersonGbp: 8_500,
      partySize: 1,
      soloPreference: "will_share",
      mustHaveActivityIds: [],
    },
    partyDescription: "Solo traveller in his 30s, happy to share",
    softPreferences: ["chicks if possible", "smallest group possible"],
    expectedTop: "dep_075",
    competitor: "dep_083 (latest sailing, but the biggest ship of the four and past chick season)",
    why: "Early February still has chicks, and it's the smallest ship that fits his budget.",
  },
  {
    id: "kayak-couple",
    notes: `Ana & Luis, both paddlers, kayaking is non-negotiable, the whole reason for the trip. Feb only, school term holidays for Ana (teacher). Budget 14k pp incl kayak. Want small ship, intimate, budget's not the main worry.`,
    rules: {
      windowStart: "2027-02-01",
      windowEnd: "2027-02-28",
      budgetPerPersonGbp: 14_000,
      partySize: 2,
      soloPreference: "either",
      mustHaveActivityIds: ["act_kayak"],
    },
    partyDescription: "Couple, both experienced kayakers",
    softPreferences: ["kayaking is the point of the trip", "smallest ship possible", "price is secondary"],
    expectedTop: "dep_074",
    competitor: "dep_075 (cheaper, but a slightly bigger ship, and price isn't their priority)",
    why: "The smallest ship with kayak places for both of them, and they put an intimate ship above price.",
  },
  {
    id: "family-christmas",
    notes: `The Okafor family, 4 of them (kids 12 + 15), want Christmas on board, school hols only, back by 6 Jan. Budget 12k pp but would love to spend less, 4 people adds up! Kids want penguins and snowball fights. One cabin type for all of them ideally.`,
    rules: {
      windowStart: "2026-12-19",
      windowEnd: "2027-01-06",
      budgetPerPersonGbp: 12_000,
      partySize: 4,
      soloPreference: "either",
      mustHaveActivityIds: [],
    },
    partyDescription: "Family of four with children aged 12 and 15",
    softPreferences: ["Christmas on board", "would like to spend less than the budget", "kids want penguins"],
    expectedTop: "dep_045",
    competitor: "dep_047 (small ship, but sails after Christmas and costs far more)",
    why: "Christmas on board on a small ship, and the cheapest by a wide margin, which matters for 4 people.",
  },
  {
    id: "tight-budget-landing",
    notes: `Jamie + Chris, students-ish, tight money, 6k pp absolute max. Any time Nov to mid March. Only real requirement: they MUST set foot on Antarctica, "not just look at it from a boat". Happy with basic cabins.`,
    rules: {
      windowStart: "2026-11-01",
      windowEnd: "2027-03-15",
      budgetPerPersonGbp: 6_000,
      partySize: 2,
      soloPreference: "either",
      mustHaveActivityIds: [],
    },
    partyDescription: "Young couple on a tight budget",
    softPreferences: ["must land on Antarctica", "basic cabins are fine"],
    expectedTop: "dep_013",
    competitor: "dep_015 (the cheapest trip, but a 920-passenger ship that can't land)",
    why: "The only ship in budget small enough to land passengers, where every cheaper option is a ship that can't.",
  },
  {
    id: "south-georgia-dream",
    notes: `Fiona, bringing her sister Kate, South Georgia has been the dream for 20 years, king penguins, Shackleton's grave. Want the longest trip they can get, 3 weeks fine. After Christmas, Jan or Feb. Up to 15.5k pp. Small ship strongly preferred.`,
    rules: {
      windowStart: "2026-12-26",
      windowEnd: "2027-02-28",
      budgetPerPersonGbp: 15_500,
      partySize: 2,
      soloPreference: "either",
      mustHaveActivityIds: [],
    },
    partyDescription: "Two sisters, long-held dream trip",
    softPreferences: ["South Georgia is the priority", "the longer the better", "small ship strongly preferred"],
    expectedTop: "dep_054",
    competitor: "dep_050 (21-night South Georgia trip for less, but on a ship more than twice the size)",
    why: "The longest South Georgia voyage, on a 110-passenger ship.",
  },
];
