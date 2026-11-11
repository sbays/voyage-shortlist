# Evaluation

The evaluation runs both Claude calls over 10 invented briefs in `src/evals/cases.ts`. Each brief names the departure a good specialist would put first, and the runner reports how often that departure lands in the top 3 and at number 1.

## What one run does

For each case, the runner:

1. **Extracts** the brief from the case's rough call notes. Each field (date window, budget, party size, solo preference, activities) is scored against the rules the specialist would confirm on the form.
2. **Searches** the seeded catalogue (in-memory PGlite) with those confirmed rules. The specialist corrects the form before searching, so ranking is scored independently of extraction.
3. **Ranks** the candidates, and records where the expected departure landed: 1, 2, 3 or a miss.

Calls run one at a time to stay inside rate limits.

## Pass bar

From `DECISIONS.md`: a full run passes when **at least 7 of 10** expected picks land in the top 3 and **at least 4** land at number 1. The script exits with code 1 when the bar isn't met. A single-case run (`--case`) reports only and doesn't apply the bar.

## Running it

Every run calls the real API and **costs real money**. A full run costs about **£0.30**, and at most about £0.60 if the ranking retries. The estimate:

| Call | Model | Per case | Approx. cost per case |
| --- | --- | --- | --- |
| Extract the brief | Claude Haiku 5.5 | ~2,000 tokens in, ~800 out (including thinking) | under £0.001 |
| Rank and explain | Claude Sonnet 5.5 | ~5,000 tokens in, ~2,500 out (including thinking) | about £0.03, doubled on a retry |

The script prints the exact cost from the token counts each response reports.

Pull the key from Secret Manager inside the command, so it never lands in your shell history or in a file:

```sh
ANTHROPIC_API_KEY="$(gcloud secrets versions access latest --secret=anthropic-api-key --project=tern-floe)" node src/evals/run.ts
```

Run one case:

```sh
ANTHROPIC_API_KEY="$(gcloud secrets versions access latest --secret=anthropic-api-key --project=tern-floe)" node src/evals/run.ts --case seasick-fly-cruise
```

To compare models, set `CLAUDE_EXTRACT_MODEL` or `CLAUDE_RANK_MODEL` for the run.

## Output

- A table per case (expected pick, rank, picks, extraction fields right, cost), then the totals: top 3 and number 1 hits against the bar, extraction accuracy per field, tokens, cost in GBP and wall time.
- A JSON report in `evals/results/<timestamp>.json`, ignored by git.

## Keeping the cases fair

`src/evals/cases.test.ts` runs in `pnpm test` with no API calls. It checks that, for every case:

- the rules are a valid brief
- the expected pick is a candidate and is inside the 20 departures sent to ranking
- there are at least 3 candidates
- the named competitor is a candidate too

So a low score means a weak ranking, not an impossible case.
