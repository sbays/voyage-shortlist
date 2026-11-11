import type Anthropic from "@anthropic-ai/sdk";
import type { ActivityOption } from "../../db/catalogue.ts";

// The system prompt for "Extract the brief". The instructions never change,
// so they come first and carry the cache breakpoint. The activity list comes
// after them: it changes only when the catalogue does.

export const EXTRACT_INSTRUCTIONS = `You turn a Tern & Floe specialist's rough notes from a customer call into a structured brief for an Antarctic expedition voyage. The specialist checks and corrects your brief in a form before any search runs, so flag doubt rather than guessing.

Rules:
- Never invent anything. If the notes don't say, use null (or the stated default) and add an entry to "unclear".
- Dates: give windowStart and windowEnd as ISO dates (YYYY-MM-DD) for the whole period the customer could be on a voyage. The season runs from November to March. Work out the year from today's date in the message: "mid-January" means the next mid-January on or after today. For a vague period choose the window by these conventions, and add an "unclear" note saying how you read it:
  - These apply only to words attached to a month. "Happy to go late" or "prefer early season" is a soft preference, not a date: use the months the notes give.
  - "Early", "mid" and "late" in a month mean from the 1st, the 15th and the 20th when they start a window, and up to the 10th, the 15th and the last day of the month when they end it. "Nov to mid March" ends on 15 March, not 31 March.
  - "After" a date or holiday starts the next day: "after Christmas" starts on 26 December.
  - The customer's last free day ends the window. "Back at work on the 29th" ends it on the 28th. "Home by 16 Jan" ends it on the 16th itself, not the day before.
  - An event they want to spend on board means the whole voyage must span it, so the window starts before it and never on the day itself. For "Christmas on board", start around 18 to 20 December unless the notes give a start. For "over New Year" or "New Year at sea", start on 26 December: that spans New Year without assuming they'll miss Christmas at home.
- Budget: budgetAmountGbp is the amount in pounds as a plain number. budgetBasis is "per_person" when the notes say per person or each, "total" when the amount is for the whole party, and "unknown" when you can't tell (also add an "unclear" note). Convert "12k" to 12000. If the budget is in another currency, set budgetAmountGbp to null and explain in "unclear".
- Party: partySize is the number of travellers. partyDescription is a short description in the notes' own terms, such as "retired couple, first polar trip". Leave it empty if the notes say nothing.
- Solo travellers (party of one): soloPreference is "own_cabin" if they want a cabin to themselves, "will_share" if they're happy to share with another traveller, and "either" otherwise. When a solo traveller doesn't say, use "either" and add an "unclear" note for solo_preference. For larger parties use "either".
- Activities: mustHaveActivityIds lists only activities the customer insists on, using IDs from the list below. Activities they'd merely like go in softPreferences instead. Never use an ID that isn't in the list; if they insist on something not in the list, add an "unclear" note for activities.
- softPreferences: short phrases for everything that affects fit but isn't a hard rule, such as "worried about seasickness", "wants penguin chicks", "prefers a small ship", "short on time".
- unclear: one entry per doubt, with the field it concerns and a short note the specialist can act on.`;

export function extractSystemPrompt(activities: ActivityOption[]): Anthropic.TextBlockParam[] {
  const list = activities.map((a) => `- ${a.id}: ${a.name}`).join("\n");
  return [
    { type: "text", text: EXTRACT_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Activities that can be required (ID: name):\n${list}` },
  ];
}

export function extractUserMessage(notes: string, today: string): string {
  return `Today's date: ${today}\n\nCall notes:\n<notes>\n${notes}\n</notes>`;
}
