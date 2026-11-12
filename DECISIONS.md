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

- **Decision:** the CSV upload needs a demo admin token stored in Secret Manager. Reviewers instead see a page explaining the import, with a sample file. Saved briefs are visible to everyone: the demo banner says so, and the notes box warns against entering real personal data. A weekly Cloud Run job re-runs the seed, which resets fares and availability (saved briefs are kept: see "a reseed keeps saved briefs").
- **Since Phase 4 review:** wrong admin tokens are limited to 10 per address per hour (counted in `rate_limits` under a hash of the address, checked before the file is read). With no token configured, the public sees only "Uploads aren't available right now." The token field lets the browser's password manager save it (a hidden "admin" username, `autocomplete="current-password"`), so it's fetched from Secret Manager once; the app never stores it. The list of recent imports is shown only after a valid token, in that admin's form response, never in the page: filenames are user-generated content.
- **Why:** anyone with the link could otherwise sell out every departure or read other visitors' notes. A weekly reset keeps the demo in a known state.

## 2026-11-11: rate limits and instance cap

- **Decision:** 30 Claude calls per IP per hour, counting both extraction and ranking (about 15 full shortlists), and 200 Claude calls per hour across the whole app. Cloud Run runs between 0 and 2 instances. The Anthropic key's spend limit is the final backstop.
- **Why:** generous enough for reviewers, with a hard ceiling on cost.

## 2026-11-11: CSV import format

- **Decision:** columns `departure_id, cabin_category_id, price_gbp_pp, solo_price_gbp, berths_left, updated_at`. An import only updates existing fares and never creates departures. It's all or nothing: any bad row (an unknown ID, negative berths, and so on) rejects the whole file and lists every error with its row number. `availability_updated_at` is taken from the file's `updated_at` values, not the upload time.
- **Since Phase 4 review:** a row whose `updated_at` is older than the departure's stored availability is rejected (re-uploading the same timestamps is allowed), so an old or replayed file can't move "availability as of" backwards. The checks and the updates run in one transaction with the fare and departure rows locked, and if the number of rows updated differs from the rows sent, the import rolls back and is recorded as rejected. Prices are capped at £1,000,000 and berths at 10,000. Error rows are spreadsheet rows: the header is row 1 and blank lines count. Server action bodies are allowed up to 1,100 KB so a file near the 1 MB cap reaches the action, and the browser checks the size first. The sample file is generated from the live catalogue at request time (`/import/sample-availability.csv`), so it always opens berths on a real sold-out fare with a current timestamp.
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
- **Two reviews (from Phase 3):** `/code-review` and `/mr-review` run side by side, and their findings are compared in one report. In Phase 3 they overlapped on only 3 of 29 findings: `/code-review` found the abuse and correctness problems (unlimited brief inserts, uncapped notes, a false "Saved"), and `/mr-review` found the React, accessibility and bundle problems (heading levels, zod in the client bundle, a stale-state toggle).

## 2026-11-11: checks on every PR, run by an account that can't deploy

- **Decision:** a second trigger, `pr-checks`, runs `cloudbuild-pr.yaml` on every PR to main, so the `protect-main` ruleset can require it to pass. Both build files run the same `pnpm verify` script (typecheck, lint, test), so PR checks and deploy checks can't drift apart. The trigger runs as `voyage-pr-checks`, which is granted only `roles/logging.logWriter`. External contributors' PRs wait for the owner's `/gcbrun` comment, while the owner's PRs run automatically. Re-running the setup step checks an existing trigger's account, build file and comment setting, and stops if any of them is wrong.
- **Why:** the repo is public, and a PR build uses the config from the PR's own branch, so whoever opens the PR controls every step, including `pnpm install`. The protection is exactly the account's roles, nothing more. With log writing as its only role, the build can't deploy, push images or read secrets. Any role added to `voyage-pr-checks` later becomes reachable by PR code, so it must stay log-only. pnpm 11 also skips dependency install scripts unless they're allowed in `pnpm-workspace.yaml` (`allowBuilds`, currently all disabled), which reduces what a malicious dependency could run.
- **Required check name:** not assumed, but read from the first PR that ran the trigger (PR #2). It's `pr-checks (tern-floe)`, the trigger name plus the project ID. `protect-main` requires it. Renaming the trigger or moving projects changes the name, and the ruleset must be updated to match, or every PR is blocked.

## 2026-11-11: Vitest config is `vitest.config.mts`

- **Decision:** the Vitest config uses the `.mts` extension rather than adding `"type": "module"` to `package.json`.
- **Why:** Vite 8 warned that its future native config loader would load a `.ts` file as CommonJS. `.mts` fixes that for this one file, without changing how Next.js and ESLint load their configs.

## 2026-11-11: Postgres on Neon's free tier, not Cloud SQL

- **Decision:** the database is a Neon free-tier Postgres 17 project in AWS London, reached with `pg` over TLS. The connection strings live in Secret Manager. This replaces the plan's Cloud SQL with IAM database authentication.
- **Why:** the smallest Cloud SQL instance costs about £8 a month even when idle, which is a lot for a demo. Neon suspends after a few idle minutes, wakes in under a second and costs nothing at this size. The SQL, migrations and tests are unchanged, since it's still Postgres. The README will explain that a real deployment would use Cloud SQL with IAM database auth through the connector, and Secret Manager still shows how secrets are handled.
- **Budget:** the £20 alert stays.

## 2026-11-11: PGlite for tests and local dev

- **Decision:** Vitest and `pnpm dev` use PGlite (Postgres compiled to WASM, running in the process) behind a small `Db` interface (`src/db/db.ts`). Only Cloud Run and the db job use `pg`. Locally, with no `DATABASE_URL`, the app migrates a PGlite database in `.data/` and seeds it if it's empty.
- **Why:** tests need real Postgres, but neither the PR checks build nor the sandbox can run Docker. PGlite needs no service and no cloud credentials. The risk is small differences from Neon, which are acceptable because the queries are plain Postgres.
- **Dates:** queries select dates as text (`::text`), so neither driver shifts a calendar date through a time zone.

## 2026-11-11: migrations and seed run as a Cloud Run job

- **Decision:** plain SQL files in `src/db/migrations/`, applied in name order by `node src/db/cli.ts migrate`. Each file runs in its own transaction under an advisory lock and is recorded in `schema_migrations`. The `voyage-db` Cloud Run job runs the CLI from a separate `db` image target. Cloud Build runs `migrate` after pushing the images and before deploying, so a failed migration stops the deploy. `seed` is run by hand for now and becomes the weekly reset in Phase 4.
- **Why:** migrating at app startup could race between the 2 instances. A job is in the planned stack anyway.
- **No build step:** the CLI runs on Node 24's built-in TypeScript type stripping. That's why `src/db` and `src/domain` import each other with relative `.ts` paths, no `@/` alias, and only erasable syntax (`erasableSyntaxOnly` in `tsconfig.json`).

## 2026-11-11: two database roles

- **Decision:** `voyage_admin` owns the schema and is used only by the db job. `voyage_web` is used by Cloud Run and can only read and write rows. `migrate` grants it `SELECT, INSERT, UPDATE, DELETE` on every table, including future ones through default privileges, but not writes to `schema_migrations`. Each role's connection string is a separate secret, readable only by its own service account (`voyage-db` or `voyage-web`).
- **Why:** a bug or SQL injection in the web app can't drop or alter tables.

## 2026-11-11: what the search treats as close

- **Decision:**
  - A departure that doesn't offer a must-have activity at all is excluded, not a near miss. Only a shortage of places on an offered activity counts as close.
  - A solo traveller sharing a cabin needs 1 berth left. One who wants their own cabin needs as many berths left as the cabin sleeps, because berths count beds and a private twin takes both. Without that, the last bed in a half-occupied twin would show as a private cabin.
  - When near misses tie on distance, the cheaper fare comes first, then the earlier start date.
  - Near misses are picked in rounds, each rule's closest first and then each rule's second closest, in the order budget, dates, berths, activity places, solo price. A departure appears once, under the first rule that reaches it.
- **Why:** "no kayaking on this ship" isn't something a bit more money or flexibility can fix, so it isn't close. Picking in rounds stops one rule filling all 6 slots.

## 2026-11-11: Claude models and the key

- **Decision:** extraction uses `claude-haiku-5-5` and ranking uses `claude-sonnet-5-5`, overridable with `CLAUDE_EXTRACT_MODEL` and `CLAUDE_RANK_MODEL`. Both calls send a Zod schema as `output_config.format`, but use `messages.create` and validate the reply themselves, not `messages.parse`. `parse` validates before returning, so a reply cut off at `max_tokens` would surface as a schema error and lose the stop reason, and refusal handling depends on reading `stop_reason` first. Ranking goes through the beta endpoint for the server-side refusal fallback (`fallbacks: "default"`), so a refused ranking is retried on a fallback model in the same call. Ranking allows 120 seconds and 1 SDK retry, because a timed-out ranking is expensive to repeat. The API key sits in its own Console workspace with a monthly spend limit, is stored as the `anthropic-api-key` secret, and only `voyage-web` can read it. Prices for the cost report are in `src/claude/models.ts`, with a fixed USD to GBP rate of 0.79.
- **Why:** the plan asks for a small, cheap model for extraction and a mid-tier one for ranking. At current prices Haiku 5.5 costs a twentieth of Sonnet 5.5 per token, and extraction is a simple task.
- **Logging to `shortlists`:** the calls return their model, tokens and latency, and Phase 3 writes them to `shortlists` when that table is created alongside `briefs`. Phase 2 has no tables to write to yet.

## 2026-11-11: reading vague dates, and how the evaluation grades them

- **Decision:** the extraction prompt fixes conventions for vague dates. "Early", "mid" and "late" start a window on the 1st, 15th and 20th and end it on the 10th, 15th and last day, and apply only to words attached to a month. "After Christmas" starts on 26 December. A last free day ends the window ("back at work on the 29th" ends on the 28th, "home by 16 Jan" on the 16th). An event spent on board must fall inside the voyage: "Christmas on board" starts around 18 to 20 December, "over New Year" on 26 December. The evaluation grades each window as exact, close (both ends within 3 days) or wrong, and counts exact and close as correct.
- **Why:** notes like "mid Jan" have no single right answer, and the specialist checks the dates on the form before any search runs. Fixed conventions make extraction predictable, and the tolerance stops the evaluation failing on a day's difference while still catching real errors such as a Christmas trip starting on Christmas Day.
- **Known conflict:** the `solo-own-cabin` case expects "late Nov" to start on 15 November, not the 20th, because the expected departure leaves on the 16th. The case stays as written: it shows a specialist widening the window, and moving it would drop the departure it expects.
- **Result:** windows went from 3 of 10 exact to 7 exact and 2 close, with ranking unchanged at 10 of 10 in the top 3.

## 2026-11-11: Phase 3 server actions and tables

- **Decision:** three server actions in `src/app/actions.ts`: extract the brief, run the shortlist, save a brief. The brief is stored only when the specialist runs the shortlist, after the form validates (`parseBriefForm`), and every run is logged to `shortlists` with its summed usage, including failed runs. Saving a brief re-runs the search on the stored brief rather than taking candidate IDs from the browser. The rate limit counts one per extraction and one per shortlist run (a retry inside a ranking isn't counted twice) and is checked before anything is stored. A run with nothing to rank makes no Claude call but still counts, because every run stores a brief and the limit is what caps those writes. Any failure, including the database being down, comes back as an error state so the form keeps its values; `src/app/error.tsx` is the fallback. Only saved briefs have a page at `/briefs/[id]`. Limits are fixed one-hour windows in Postgres keyed by a hash of the address, so they hold across instances and no raw IP is stored. The address is the last `X-Forwarded-For` entry, the one Cloud Run's front end adds. Checked on the live site on 2026-11-11: the stored key matched the hash of the visitor's own (IPv6) address.
- **Dynamic routes:** `/` (the actions), `/briefs` and `/briefs/[id]` read the database at request time, with `await connection()` inside `<Suspense>`. The site nav is in `<Suspense>` too, because `usePathname` reads an unknown param on `/briefs/[id]`.
- **Why:** each action is a public POST endpoint, so each validates its own input and trusts no IDs from the client. Counting in Postgres avoids adding Redis for a demo.

## 2026-11-11: PGlite isn't bundled

- **Decision:** `next.config.ts` lists `@electric-sql/pglite` in `serverExternalPackages`, so the dev server loads it from `node_modules`.
- **Why:** bundled by Turbopack, PGlite resolves its WebAssembly and data files to URLs inside `.next` that `fs` can't read, and every server action failed locally. Production uses `pg` and never loads PGlite.

## 2026-11-11: the demo's season rolls forward

- **Decision:** the seed generates the same catalogue as always (the 2026 to 2027 season, fixed random seed) and then shifts every date by whole years, so the season is the next November to March from the day it runs. From April the next season is seeded; from January to March the season in progress stays. IDs, prices and availability don't change, only dates, and "availability as of" is set relative to when the seed ran. The weekly reseed keeps it current. Tests and the evaluation seed with no shift, so their fixed dates and expected picks still hold. The example notes on the home page take their years from the season actually in the database.
- **Why:** extraction reads vague dates ("mid Jan") against today, so a fixed season goes stale month by month and the demo would end up finding nothing. Shifting by whole years keeps Christmas on 25 December and every edge case intact.

## 2026-11-11: a reseed keeps saved briefs

- **Decision:** reseeding empties the catalogue with `TRUNCATE ... CASCADE`, which also empties `brief_known_departures` and `matches`. Departure IDs are the same in every seed, so the seed copies both tables aside first and puts back every row whose departure still exists: a departure a brief saw before never comes back as "new", and unseen matches survive. That is plain SQL inside the catalogue transaction, so its locks are brief. Each saved brief's current candidates are then recorded as known in small transactions of their own, after the catalogue is unlocked. Saved briefs and their logged shortlists stay. A saved brief that no longer parses, or whose search fails, is logged and skipped by both the reseed and the nightly job, which counts it in `match_runs.briefs_failed` and always finishes its run. This replaces the earlier plan for the weekly reset to clear saved briefs.
- **Why:** a reviewer's saved brief shouldn't vanish at the weekly reset, "New matches" must only ever mean new, and one bad row must not stop the jobs for everyone.

## 2026-11-11: departures that have sailed are left out

- **Decision:** the search, the exclusion counts, the nightly job, "New matches" and `/departures` leave out departures that start before today (UTC). Tests and the evaluation pass no date and see the whole catalogue.
- **Why:** from January to March the rolling season keeps the season in progress, so November and December departures have already sailed and must not be offered.

## 2026-11-12: new matches don't rewrite a saved shortlist

- **Decision:** a saved brief's page shows its latest logged shortlist as it was built, with a notice saying when it was built, how many new matches have arrived since and that availability may have changed. A "Rebuild with current availability" button searches the stored brief again, ranks it with Claude, writes a fresh email and logs a new shortlist (earlier ones stay in the log), then records the departures it showed as known (so the nightly job won't report them as new) and marks as seen only the matches found before its search started (one written while Claude was ranking stays new). If the new shortlist can't be logged, the rebuild reports an error and changes nothing. It's rate-limited like any other run, and only saved briefs can be rebuilt: the brief's ID is bound on the server, but a client could send another, which is fine because saved briefs are public in the demo. Nothing rebuilds automatically.
- **Why:** the saved shortlist is a record of what was ranked and possibly sent, so it shouldn't change without the specialist choosing to. Including a match means a new ranking call, which costs money and shouldn't run nightly for briefs nobody is looking at. A full rebuild keeps the picks, reasons and email consistent, where splicing new matches into an old email would mix old prices with new ones.

## Open

- **Keep focus on submit buttons while they work.** Every submit button disables itself while pending (`disabled={pending}`), which drops keyboard focus to the page body in most browsers. Switch them all together to `aria-disabled` with a guard against a second submit, so focus stays on the button. Raised in the rebuild review (R5) and left for one change across the app.
