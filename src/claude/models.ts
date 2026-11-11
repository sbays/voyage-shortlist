// Which Claude model each call uses, overridable by environment variable.
// The plan asks for a small, cheap model for extraction and a mid-tier one
// for ranking.

// `||`, not `??`: an empty variable (an unset value interpolated by a shell
// or CI file) means "not set", not a model called "".
export const MODELS = {
  extract: process.env.CLAUDE_EXTRACT_MODEL || "claude-haiku-5-5",
  rank: process.env.CLAUDE_RANK_MODEL || "claude-sonnet-5-5",
} as const;

/** USD per million tokens, from the Anthropic price list (checked 2026-11-11). */
interface Price {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICES_USD: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  // A refusal fallback can answer from the previous Sonnet.
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

/** A fixed rate is fine for comparing runs; it isn't for accounting. */
export const USD_TO_GBP = 0.79;

export interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
}

/**
 * Cost of one call in GBP, or null for a model with no listed price. A dated
 * snapshot ID such as `claude-sonnet-5-5-20261101` is priced as its model.
 */
export function costGbp(usage: CallUsage): number | null {
  const price = PRICES_USD[usage.model] ?? PRICES_USD[usage.model.replace(/-\d{8}$/, "")];
  if (!price) return null;
  const usd =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheWriteTokens * price.cacheWrite +
      usage.cacheReadTokens * price.cacheRead) /
    1_000_000;
  return usd * USD_TO_GBP;
}
