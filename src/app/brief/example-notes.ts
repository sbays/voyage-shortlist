// Example call notes a visitor can load into the notes box, each showing a
// different part of the tool. They are adapted from the evaluation cases but
// deliberately separate from them: the eval set (with its expected answers)
// stays out of the browser bundle, and tuning an eval case never changes the
// home page. Dates are explicit, with years, because extraction reads vague
// dates against today. The years come from the season in the database, which
// the seed rolls forward (DECISIONS.md, "the demo's season rolls forward").

export interface ExampleNotes {
  id: string;
  title: string;
  /** What this example shows off, in a line. */
  shows: string;
  notes: string;
}

/** The examples for the season starting in November of `year`. */
export function exampleNotes(year: number): ExampleNotes[] {
  const next = year + 1;
  return [
    {
      id: "seasick-fly-cruise",
      title: "Seasick couple, short on time",
      shows: "Soft preferences decide the ranking: a fly-cruise skips the Drake Passage.",
      notes: `Call w/ Priya + husband Dev. Both terrible sailors, she was sick on the Isle of Wight ferry (!!). Dreading the Drake. Dev can only get ~10 days off, from 12 Jan ${next}, back at work 29 Jan. Budget up to 12,300 pp, firm. Want penguins obviously, not fussed about ship luxury.`,
    },
    {
      id: "solo-own-cabin",
      title: "Solo traveller, own cabin",
      shows: "Solo pricing: a cabin to herself, never shared.",
      notes: `Helen, travelling alone, 50s, definitely wants own cabin, won't share. Any time from 15 Nov to 15 Dec ${year}. Budget 13k all in. Wants a proper expedition feel, zodiac landings, lectures. Not a cruise-ship person.`,
    },
    {
      id: "kayak-couple",
      title: "Kayakers, February only",
      shows: "A must-have activity, with its price counted in the budget.",
      notes: `Ana & Luis, both paddlers, kayaking is non-negotiable, the whole reason for the trip. February ${next} only, school term holidays for Ana (teacher). Budget 14k pp incl kayak. Want small ship, intimate, budget's not the main worry.`,
    },
    {
      id: "family-christmas",
      title: "Family of 4 at Christmas",
      shows: "A party sharing one cabin type, and a total budget to watch.",
      notes: `The Okafor family, 4 of them (kids 12 + 15), want Christmas ${year} on board, school hols only, back by 6 Jan ${next}. Budget 12k pp but would love to spend less, 4 people adds up! Kids want penguins and snowball fights. One cabin type for all of them ideally.`,
    },
  ];
}
