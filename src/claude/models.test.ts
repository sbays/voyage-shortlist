import { describe, expect, it } from "vitest";
import { costGbp, USD_TO_GBP, type CallUsage } from "./models.ts";

function usage(model: string): CallUsage {
  return {
    model,
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    latencyMs: 1,
  };
}

describe("costGbp", () => {
  it("prices a listed model", () => {
    expect(costGbp(usage("claude-sonnet-5-5"))).toBeCloseTo(2 * USD_TO_GBP);
  });

  it("prices a dated snapshot as its model", () => {
    expect(costGbp(usage("claude-sonnet-5-5-20261101"))).toBeCloseTo(2 * USD_TO_GBP);
  });

  it("returns null, not 0, for a model it can't price", () => {
    expect(costGbp(usage("claude-unknown-9"))).toBeNull();
  });
});
