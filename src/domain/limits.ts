// Limits shown in the UI and enforced on the server. No imports, so client
// code can read them without pulling in zod or server modules.

/** At most this many candidates go to the ranking call, earliest first. */
export const MAX_RANKED_CANDIDATES = 20;

/** Claude calls one address can make in an hour, counting extraction and ranking. */
export const CALLS_PER_IP_PER_HOUR = 30;

/** Claude calls the whole app can make in an hour. */
export const CALLS_PER_HOUR_GLOBAL = 200;

/** Longest call notes accepted, in characters. */
export const MAX_NOTES_LENGTH = 5_000;
