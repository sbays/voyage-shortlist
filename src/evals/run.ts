// Runs the evaluation set against the real Claude API and reports how often
// the expected departure lands in the top 3 and at number 1, plus extraction
// accuracy and total cost in GBP.
//
//   node src/evals/run.ts               every case
//   node src/evals/run.ts --case <id>   one case
//
// Every run costs real money: see evals/README.md. Exit code 1 when the pass
// bar in DECISIONS.md isn't met.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractBrief } from "../claude/extract.ts";
import { ClaudeCallError } from "../claude/errors.ts";
import { type CallUsage, costGbp, MODELS } from "../claude/models.ts";
import { rankShortlist } from "../claude/rank.ts";
import { listActivities } from "../db/catalogue.ts";
import { migrate } from "../db/migrate.ts";
import { createPgliteDb } from "../db/pglite.ts";
import { searchDepartures } from "../db/search.ts";
import { seed } from "../db/seed.ts";
import { Brief, type HardRules } from "../domain/brief.ts";
import type { DraftBrief } from "../domain/draft-brief.ts";
import { EVAL_CASES, type EvalCase } from "./cases.ts";

/** The pass bar from DECISIONS.md ("evaluation pass bar"). */
const BAR = { top3: 7, first: 4 };

/** Notes say "mid Jan" without a year, so they're read as if the call was today. */
const CALL_DATE = "2026-10-01";

const RESULTS_DIR = join(import.meta.dirname, "..", "..", "evals", "results");

const EXTRACTION_FIELDS = ["window", "budget", "partySize", "soloPreference", "activities"] as const;
type ExtractionField = (typeof EXTRACTION_FIELDS)[number];

interface ExtractedFields {
  windowStart: string | null;
  windowEnd: string | null;
  budgetPerPersonGbp: number | null;
  partySize: number | null;
  soloPreference: string;
  mustHaveActivityIds: string[];
}

function fieldsOf(source: DraftBrief | HardRules): ExtractedFields {
  return {
    windowStart: source.windowStart,
    windowEnd: source.windowEnd,
    budgetPerPersonGbp: source.budgetPerPersonGbp,
    partySize: source.partySize,
    soloPreference: source.soloPreference,
    mustHaveActivityIds: source.mustHaveActivityIds,
  };
}

interface CaseResult {
  id: string;
  expectedTop: string;
  /** 1, 2 or 3, or null when the expected departure wasn't picked. */
  rank: number | null;
  picks: string[];
  extraction: Record<ExtractionField, boolean> | null;
  /** What extraction produced, beside what the specialist confirmed, for diagnosing misses. */
  extracted: ExtractedFields | null;
  expected: ExtractedFields;
  windowGrade: WindowGrade | null;
  error: string | null;
  /** Both calls failed at the API with nothing billed: later cases would fail too. */
  apiOnlyFailure: boolean;
  usage: CallUsage[];
  costGbp: number;
  unpricedModels: string[];
}

/** Each end of the window within this many days counts as "close", not wrong. */
const WINDOW_TOLERANCE_DAYS = 3;

type WindowGrade = "exact" | "close" | "wrong";

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** Vague notes ("late Nov") have more than one fair reading, so near misses are graded apart. */
function gradeWindow(draft: DraftBrief, rules: HardRules): WindowGrade {
  if (draft.windowStart === null || draft.windowEnd === null) return "wrong";
  if (draft.windowStart === rules.windowStart && draft.windowEnd === rules.windowEnd) return "exact";
  const close =
    daysApart(draft.windowStart, rules.windowStart) <= WINDOW_TOLERANCE_DAYS &&
    daysApart(draft.windowEnd, rules.windowEnd) <= WINDOW_TOLERANCE_DAYS;
  return close ? "close" : "wrong";
}

function scoreExtraction(draft: DraftBrief, rules: HardRules): Record<ExtractionField, boolean> {
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  return {
    // Exact or close: see gradeWindow.
    window: gradeWindow(draft, rules) !== "wrong",
    budget: draft.budgetPerPersonGbp === rules.budgetPerPersonGbp,
    partySize: draft.partySize === rules.partySize,
    // Only meaningful for a party of one; otherwise anything is right.
    soloPreference: rules.partySize > 1 || draft.soloPreference === rules.soloPreference,
    activities: sameSet(draft.mustHaveActivityIds, rules.mustHaveActivityIds),
  };
}

function describeError(error: unknown): string {
  if (error instanceof ClaudeCallError) return `${error.kind}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** Priced total, plus the models that couldn't be priced, so £0 never hides spend. */
function totalCost(usage: CallUsage[]): { gbp: number; unpriced: string[] } {
  let gbp = 0;
  const unpriced = new Set<string>();
  for (const u of usage) {
    const cost = costGbp(u);
    if (cost === null) unpriced.add(u.model);
    else gbp += cost;
  }
  return { gbp, unpriced: [...unpriced] };
}

function formatCost({ gbp, unpriced }: { gbp: number; unpriced: string[] }): string {
  return unpriced.length ? `£${gbp.toFixed(4)} + unpriced (${unpriced.join(", ")})` : `£${gbp.toFixed(4)}`;
}

/** A failed call was still billed: keep its usage. */
function failedUsage(error: unknown): CallUsage[] {
  return error instanceof ClaudeCallError ? error.usage : [];
}

async function runCase(
  c: EvalCase,
  db: Awaited<ReturnType<typeof createPgliteDb>>,
  activities: Awaited<ReturnType<typeof listActivities>>,
): Promise<CaseResult> {
  const usage: CallUsage[] = [];
  const errors: string[] = [];
  const failureKinds: string[] = [];

  // (a) Extraction, scored against what the specialist confirmed.
  let extraction: CaseResult["extraction"] = null;
  let extracted: ExtractedFields | null = null;
  let windowGrade: WindowGrade | null = null;
  try {
    const result = await extractBrief(c.notes, activities, { today: CALL_DATE });
    usage.push(result.usage);
    extraction = scoreExtraction(result.draft, c.rules);
    extracted = fieldsOf(result.draft);
    windowGrade = gradeWindow(result.draft, c.rules);
  } catch (error) {
    usage.push(...failedUsage(error));
    errors.push(`extract ${describeError(error)}`);
    failureKinds.push(error instanceof ClaudeCallError ? error.kind : "other");
  }

  // (b) Ranking from the confirmed rules, independent of extraction.
  let picks: string[] = [];
  try {
    const brief = Brief.parse({
      rules: c.rules,
      partyDescription: c.partyDescription,
      softPreferences: c.softPreferences,
    });
    const search = await searchDepartures(db, brief.rules);
    const result = await rankShortlist(brief, search);
    usage.push(...result.usage);
    picks = result.shortlist.picks.map((p) => p.candidate.departureId);
  } catch (error) {
    usage.push(...failedUsage(error));
    errors.push(`rank ${describeError(error)}`);
    failureKinds.push(error instanceof ClaudeCallError ? error.kind : "other");
  }

  const index = picks.indexOf(c.expectedTop);
  return {
    id: c.id,
    expectedTop: c.expectedTop,
    rank: index === -1 ? null : index + 1,
    picks,
    extraction,
    extracted,
    expected: fieldsOf(c.rules),
    windowGrade,
    error: errors.length ? errors.join("; ") : null,
    apiOnlyFailure:
      failureKinds.length === 2 && failureKinds.every((k) => k === "api") && usage.length === 0,
    usage,
    costGbp: totalCost(usage).gbp,
    unpricedModels: totalCost(usage).unpriced,
  };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY isn't set. See evals/README.md for running it with the key from Secret Manager.",
    );
    process.exitCode = 2;
    return;
  }

  const caseFlag = process.argv.indexOf("--case");
  const onlyId = caseFlag === -1 ? null : process.argv[caseFlag + 1];
  // A bare --case must not fall through to the full, paid run.
  if (caseFlag !== -1 && (!onlyId || onlyId.startsWith("--"))) {
    console.error(`--case needs an ID. Cases: ${EVAL_CASES.map((c) => c.id).join(", ")}`);
    process.exitCode = 2;
    return;
  }
  const cases = onlyId ? EVAL_CASES.filter((c) => c.id === onlyId) : EVAL_CASES;
  if (cases.length === 0) {
    console.error(`No case "${onlyId}". Cases: ${EVAL_CASES.map((c) => c.id).join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const db = await createPgliteDb();
  const started = performance.now();
  const results: CaseResult[] = [];
  let aborted = false;
  try {
    await migrate(db);
    await seed(db);
    const activities = await listActivities(db);
    // One at a time, to stay well inside rate limits.
    for (const c of cases) {
      process.stdout.write(`${c.id} ... `);
      const result = await runCase(c, db, activities);
      results.push(result);
      console.log(result.error ? `error (${result.error})` : `rank ${result.rank ?? "miss"}`);
      if (result.apiOnlyFailure) {
        // Billing, a bad key or an outage: the rest would fail the same way.
        aborted = true;
        console.error(
          `\nStopping: every call in ${c.id} failed at the API and nothing was billed. ` +
            "Fix the cause above (credit balance, key, or an outage) and run again.",
        );
        break;
      }
    }
  } finally {
    await db.close();
  }
  const wallSeconds = (performance.now() - started) / 1000;

  // Table
  console.log();
  console.log(`${pad("case", 24)}${pad("expected", 10)}${pad("rank", 6)}${pad("picks", 28)}${pad("extract", 9)}cost`);
  for (const r of results) {
    const fields = r.extraction ? Object.values(r.extraction).filter(Boolean).length : 0;
    console.log(
      pad(r.id, 24) +
        pad(r.expectedTop, 10) +
        pad(r.rank === null ? "miss" : String(r.rank), 6) +
        pad(r.picks.join(",") || "-", 28) +
        pad(r.extraction ? `${fields}/${EXTRACTION_FIELDS.length}` : "error", 9) +
        formatCost({ gbp: r.costGbp, unpriced: r.unpricedModels }),
    );
  }

  // Extraction misses, so a low score can be diagnosed: a day off, or plainly wrong.
  const misses = results.flatMap((r) => {
    if (!r.extraction || !r.extracted) return [];
    const got = r.extracted;
    const off = EXTRACTION_FIELDS.filter(
      (f) => !r.extraction?.[f] || (f === "window" && r.windowGrade === "close"),
    );
    return off.map((f) => {
      const show = (x: ExtractedFields) =>
        f === "window" ? `${x.windowStart} to ${x.windowEnd}`
        : f === "budget" ? String(x.budgetPerPersonGbp)
        : f === "partySize" ? String(x.partySize)
        : f === "soloPreference" ? x.soloPreference
        : x.mustHaveActivityIds.join(",") || "none";
      const label = f === "window" && r.windowGrade === "close" ? "window (close)" : f;
      return `  ${pad(r.id, 24)}${pad(label, 16)}expected ${show(r.expected)}, extracted ${show(got)}`;
    });
  });
  if (misses.length) {
    console.log();
    console.log("Extraction misses:");
    for (const line of misses) console.log(line);
  }

  // Totals
  const top3 = results.filter((r) => r.rank !== null).length;
  const first = results.filter((r) => r.rank === 1).length;
  const scored = results.filter((r) => r.extraction !== null);
  const correct = (f: ExtractionField) => scored.filter((r) => r.extraction?.[f]).length;
  // Spelled out so the type checker sees every field, with no cast.
  const fieldAccuracy: Record<ExtractionField, number> = {
    window: correct("window"),
    budget: correct("budget"),
    partySize: correct("partySize"),
    soloPreference: correct("soloPreference"),
    activities: correct("activities"),
  };
  const allUsage = results.flatMap((r) => r.usage);
  const tokens = {
    input: allUsage.reduce((s, u) => s + u.inputTokens, 0),
    output: allUsage.reduce((s, u) => s + u.outputTokens, 0),
    cacheRead: allUsage.reduce((s, u) => s + u.cacheReadTokens, 0),
    cacheWrite: allUsage.reduce((s, u) => s + u.cacheWriteTokens, 0),
  };
  const cost = totalCost(allUsage);
  // The bar is defined for the full set of 10; a single case only reports.
  const fullRun = !aborted && cases.length === EVAL_CASES.length;
  const passed = top3 >= BAR.top3 && first >= BAR.first;

  console.log();
  console.log(`Top 3: ${top3}/${results.length} (bar ${BAR.top3})   At #1: ${first}/${results.length} (bar ${BAR.first})`);
  const grades = (g: WindowGrade) => results.filter((r) => r.windowGrade === g).length;
  console.log(
    `Extraction (of ${scored.length}): ` +
      EXTRACTION_FIELDS.map((f) => `${f} ${fieldAccuracy[f]}`).join(", ") +
      `   (window: ${grades("exact")} exact, ${grades("close")} close, ${grades("wrong")} wrong)`,
  );
  console.log(
    `Tokens: ${tokens.input} in, ${tokens.output} out, ${tokens.cacheRead} cache read, ${tokens.cacheWrite} cache write`,
  );
  console.log(`Cost: ${formatCost(cost)}   Wall time: ${wallSeconds.toFixed(1)}s`);
  console.log(`Models: extract ${MODELS.extract}, rank ${MODELS.rank}`);
  console.log(
    aborted ? "ABORTED" : fullRun ? (passed ? "PASS" : "FAIL") : "Single case: no pass bar",
  );

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(RESULTS_DIR, `${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        models: MODELS,
        bar: BAR,
        top3,
        first,
        passed: fullRun ? passed : null,
        aborted,
        extractionFieldAccuracy: fieldAccuracy,
        tokens,
        costGbp: cost.gbp,
        unpricedModels: cost.unpriced,
        wallSeconds,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`Report: ${file}`);

  if (aborted) process.exitCode = 2;
  else if (fullRun && !passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
