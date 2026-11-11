import { z } from "zod";

// The hard rules of a brief: the part SQL decides. Soft preferences are added
// in Phase 2 and never reach a query.

const isoDate = z.iso.date();

export const SoloPreference = z.enum(["own_cabin", "will_share", "either"]);
export type SoloPreference = z.infer<typeof SoloPreference>;

export const HardRules = z
  .object({
    windowStart: isoDate,
    windowEnd: isoDate,
    /** Per person, a hard ceiling, including must-have activities. */
    budgetPerPersonGbp: z.number().int().positive(),
    partySize: z.number().int().positive(),
    /** Only used when partySize is 1. */
    soloPreference: SoloPreference.default("either"),
    mustHaveActivityIds: z
      .array(z.string().min(1))
      .default([])
      .transform((ids) => [...new Set(ids)]),
  })
  .refine((b) => b.windowEnd >= b.windowStart, {
    message: "The date window must end on or after it starts",
    path: ["windowEnd"],
  });

export type HardRules = z.infer<typeof HardRules>;
