# Decisions

Decisions made while building, in addition to the ones in `plan.md`. Newest at the bottom.

## 2026-11-11: GCP project is `tern-floe`, personal account only

- **Decision:** everything runs in the personal GCP project `tern-floe`, region `europe-west2`, under a personal Google account. Application Default Credentials use `tern-floe` as the quota project.
- **Why:** this is a portfolio project. Nothing may be created in or billed to an employer's GCP project, and the local gcloud setup previously pointed at a work project.

## 2026-11-11: code lives on GitHub under the personal account

- **Decision:** a public repo on the user's personal GitHub account, connected to Cloud Build for the push-to-main trigger.
- **Why:** reviewers can read the code from a portfolio link, and Cloud Build's GitHub connection supports the trigger the plan needs.

## 2026-11-11: pnpm 11 is the package manager

- **Decision:** pnpm, pinned through the `packageManager` field in `package.json` (currently `pnpm@11.5.1`) and enabled with Corepack locally, in the Dockerfile and in Cloud Build.
- **Why:** faster installs through a shared store, and a strict `node_modules` that stops code importing packages it hasn't declared.

## 2026-11-11: where decisions and terms are written

- **Decision:** `DECISIONS.md` is the single running log of decisions. `GLOSSARY.md` holds domain terms only. No ADR folder.
- **Why:** one place to look, for us and for portfolio reviewers.

## 2026-11-11: budget is per person and a hard ceiling

- **Decision:** the brief always stores budget per person. When the notes give a total, the draft brief divides it by the party size, and the form shows the conversion so the specialist can correct it. Any departure over budget is excluded from candidates. Departures just over budget can still appear as near misses.
- **Why:** one comparison in SQL, and near misses already cover "slightly over budget", so a tolerance would duplicate them.

## 2026-11-11: a party travels in one cabin category; berths are beds

- **Decision:** the whole party uses a single cabin category on a departure, and that fare must have `berths_left` at least equal to the party size. Mixing categories isn't supported. `berths_left` counts beds, not cabins.
- **Why:** keeps "price per person" unambiguous and the near-miss maths simple. Known simplification, to be mentioned in the README: 3 berths left can be spread across cabins that couldn't actually house the party together.

## 2026-11-11: solo preference has three values

- **Decision:** a party of one has a solo preference: own cabin (uses `solo_price_gbp`, and a fare with no solo price doesn't qualify), will share (uses `price_gbp_pp` on a cabin that sleeps 2 or more; the operator finds the roommate), or either (the cheaper qualifying option counts). The draft brief defaults to either when the notes don't say, and flags it as unclear.
- **Why:** these are the two ways solo travellers actually book, and "either" stops the tool excluding departures the customer would take.

## 2026-11-11: the whole voyage must fall inside the date window

- **Decision:** a departure fits only if its start date is on or after the window start and its end date is on or before the window end. For near misses, "days outside the window" is how far the departure runs past either edge.
- **Why:** customers' dates are usually set by leave and flights home, so a voyage ending after the window doesn't work for them.

## 2026-11-11: a candidate is a departure with its qualifying fares; picks name a cabin

- **Decision:** a candidate is a departure plus every fare on it that meets the hard rules. The ranking call returns a departure ID and a cabin category ID for each pick. The server rejects any pair that wasn't a qualifying fare, and every price shown comes from that fare.
- **Why:** comfort is a soft preference, so the choice of cabin is part of fit. Checking both IDs keeps the "no invented facts" guarantee.

## 2026-11-11: must-have activities count against the budget

- **Decision:** the budget check compares the fare per person plus the price of every must-have activity. Each must-have activity also needs places left at least equal to the party size.
- **Why:** it matches what the customer will actually pay, so a shortlist never quotes under budget and then adds hundreds of pounds of kayaking.

## 2026-11-11: near-miss rules

- **Decision:** a near miss breaks exactly one hard rule and appears once, at its closest fare. Up to 2 per rule, closest first, at most 6 in total. Distances are budget (pounds over), date window (days outside), berths (short by N) and activity places (short by N), and each is ranked only against its own kind. A fare with no solo price is a near miss only when a shared fare fits, labelled "no single cabin, sharing available". Near misses are returned on every run, not only when there are no candidates.
- **Why:** pounds and days can't be compared fairly. Near misses are useful even when candidates exist ("for £400 more...").

## 2026-11-11: the ranking prompt sees at most 20 candidates

- **Decision:** when more than 20 departures qualify, the 20 earliest by start date go to the ranking call, and the shortlist says how many weren't ranked and suggests narrowing the brief.
- **Why:** keeps input tokens and quality under control. Ordering by date is neutral; ordering by price would quietly favour budget ships and undermine impartiality.

## 2026-11-11: what counts as a match

- **Decision:** a match is a departure that is a candidate for a saved brief now and has never been one for that brief before, whether it's a new departure or a changed one. The brief's candidates at save time are recorded so they never appear as new. Each match is written once, and price changes alone never create one. When the "New matches" list is shown, every match is checked against current data, and any that no longer fit are marked "no longer available" rather than deleted.
- **Why:** specialists only want to hear about genuinely new options, and they need to know when one has gone.

## 2026-11-11: keep Next 16 `cacheComponents` and `partialPrefetching`

- **Decision:** keep both scaffold defaults. Every route or component that reads fares, availability or briefs opts out of caching explicitly, and the dynamic routes are listed here as they're built.
- **Why:** these are current Next.js defaults and worth showing in the portfolio. An explicit opt-out means "availability as of" is never served from a stale cache.

## 2026-11-11: shortlists with fewer than 3 candidates

- **Decision:** with 1 or 2 candidates, the shortlist has 1 or 2 picks, never padded with near misses. With 0 candidates, there are no picks: the ranking call explains the 2 or 3 most useful near misses, and the email draft becomes a "here's what it would take" message. With 0 candidates and 0 near misses, Claude isn't called, and the page names the hard rule that excluded the most departures.
- **Why:** a near miss shown as a pick would mislead the customer. Skipping the call when there's nothing to rank saves cost.

## 2026-11-11: the email is signed with the specialist's name

- **Decision:** the brief form has a "Your name" field, remembered in the browser and used only in the email's sign-off placeholder.
- **Why:** the email goes out from a real person. There's no sign-in in the demo, so the browser is the simplest place to keep the name.

## 2026-11-11: protecting writes on the public demo

- **Decision:** the CSV upload needs a demo admin token stored in Secret Manager. Reviewers instead see a page explaining the import, with a sample file. Saved briefs are visible to everyone: the demo banner says so, and the notes box warns against entering real personal data. A weekly Cloud Run job re-runs the seed, which resets fares, saved briefs and matches.
- **Why:** anyone with the link could otherwise sell out every departure or read other visitors' notes. A weekly reset keeps the demo in a known state.

## 2026-11-11: rate limits and instance cap

- **Decision:** 30 Claude calls per IP per hour, counting both extraction and ranking (about 15 full shortlists), and 200 Claude calls per hour across the whole app. Cloud Run runs between 0 and 2 instances. The Anthropic key's spend limit is the final backstop.
- **Why:** generous enough for reviewers, with a hard ceiling on cost.

## 2026-11-11: CSV import format

- **Decision:** columns `departure_id, cabin_category_id, price_gbp_pp, solo_price_gbp, berths_left, updated_at`. An import only updates existing fares and never creates departures. It's all or nothing: any bad row (an unknown ID, negative berths, and so on) rejects the whole file and lists every error with its row number. `availability_updated_at` is taken from the file's `updated_at` values, not the upload time.
- **Why:** a half-applied feed leaves availability inconsistent. "Availability as of" has to mean when the operator last confirmed, not when we uploaded.

## 2026-11-11: evaluation pass bar

- **Decision:** with the 10 evaluation briefs, a run passes when at least 7 expected picks land in the top 3 and at least 4 land at number 1. Every run reports its total cost in GBP.
- **Why:** "most" needs a number before it can be tested, and reporting cost lets prompt changes be compared on both quality and cost.

## 2026-11-11: GCP setup is a re-runnable script; the deployer can't change IAM

- **Decision:** `scripts/gcp-setup.sh` creates everything Phase 0 needs, in four steps (`base`, `connect`, `trigger`, `public`). Two service accounts: `voyage-web` runs the Cloud Run service and has no roles until Phase 1, and `voyage-build` runs the trigger with only `logging.logWriter`, `run.developer`, `artifactregistry.writer` on the one repo, and `iam.serviceAccountUser` on `voyage-web`. Public access (`allUsers` as `run.invoker`) is granted once by hand after the first deploy, not by `--allow-unauthenticated` in `cloudbuild.yaml`. The budget alert is £20 a month, with emails at 50% and 90% of actual spend and 100% of forecast. Cloud Build uses a 2nd-gen GitHub connection in `europe-west2`.
- **Why:** `--allow-unauthenticated` needs `run.admin`, which would let a compromised build change any service's IAM. A script is reviewable, repeatable and shows the setup in the portfolio.
- **Cloud Build's service agent and Secret Manager:** Google's docs ask for project-wide `secretmanager.admin` on the Cloud Build service agent, so it can store the GitHub token when the connection is created. `connect` grants it only for that step. `trigger` then replaces it with `secretAccessor` on the one token secret, so the agent can't read the Anthropic key added in Phase 2. If the connection ever needs re-authorising, re-run `connect` and then `trigger`.
- **Public access can be lost:** recreating the Cloud Run service drops the `allUsers` binding. The `check-public` build step prints a warning when that happens, and the build stays green.

## 2026-11-11: a branch and PR for every stage, reviewed first

- **Decision:** each stage of work is done on its own branch. Before a PR is created, `/code-review` runs on the stage's changes and every finding is reported to the user, who decides which ones to fix. Then `/pr` writes the PR description, the PR is opened, and merging it to main triggers the deploy. The push-to-main trigger is unchanged: a merge is the push.
- **Why:** bugs are caught before they reach main, where every push deploys. The user stays in charge of which findings matter. Portfolio reviewers can read the project stage by stage, one PR at a time.
- **Replaces:** an earlier decision the same day to review before each commit and commit straight to main.

## 2026-11-11: checks on every PR, run by an account that can't deploy

- **Decision:** a second trigger, `pr-checks`, runs `cloudbuild-pr.yaml` on every PR to main, so the `protect-main` ruleset can require it to pass. Both build files run the same `pnpm verify` script (typecheck, lint, test), so PR checks and deploy checks can't drift apart. The trigger runs as `voyage-pr-checks`, which is granted only `roles/logging.logWriter`. External contributors' PRs wait for the owner's `/gcbrun` comment, while the owner's PRs run automatically. Re-running the setup step checks an existing trigger's account, build file and comment setting, and stops if any of them is wrong.
- **Why:** the repo is public, and a PR build uses the config from the PR's own branch, so whoever opens the PR controls every step, including `pnpm install`. The protection is exactly the account's roles, nothing more. With log writing as its only role, the build can't deploy, push images or read secrets. Any role added to `voyage-pr-checks` later becomes reachable by PR code, so it must stay log-only. pnpm 11 also skips dependency install scripts unless they're allowed in `pnpm-workspace.yaml` (`allowBuilds`, currently all disabled), which reduces what a malicious dependency could run.
- **Required check name:** not assumed, but read from the first PR that ran the trigger (PR #2). It's `pr-checks (tern-floe)`, the trigger name plus the project ID. `protect-main` requires it. Renaming the trigger or moving projects changes the name, and the ruleset must be updated to match, or every PR is blocked.

## 2026-11-11: Vitest config is `vitest.config.mts`

- **Decision:** the Vitest config uses the `.mts` extension rather than adding `"type": "module"` to `package.json`.
- **Why:** Vite 8 warned that its future native config loader would load a `.ts` file as CommonJS. `.mts` fixes that for this one file, without changing how Next.js and ESLint load their configs.

## Open

- **Anthropic API key:** a dedicated key with a spend limit, needed from Phase 2.
