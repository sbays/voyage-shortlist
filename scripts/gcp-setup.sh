#!/usr/bin/env bash
# One-off GCP setup for the Tern & Floe voyage shortlist. Safe to re-run:
# each step skips anything that already exists.
#
# Usage, in order:
#   bash scripts/gcp-setup.sh base      # APIs, registry, service accounts, budget
#   bash scripts/gcp-setup.sh connect   # links Cloud Build to GitHub (browser steps)
#   bash scripts/gcp-setup.sh trigger   # push-to-main trigger, once connect is COMPLETE
#   bash scripts/gcp-setup.sh public    # after the first deploy: open the demo to everyone
#   bash scripts/gcp-setup.sh pr-checks # typecheck, lint and test on every PR to main
set -euo pipefail

PROJECT=tern-floe
REGION=europe-west2
AR_REPO=voyage-shortlist
SERVICE=voyage-shortlist
CONNECTION=github
GH_REPO_NAME=voyage-shortlist
BUDGET_GBP=20

WEB_SA="voyage-web@${PROJECT}.iam.gserviceaccount.com"
BUILD_SA="voyage-build@${PROJECT}.iam.gserviceaccount.com"
PR_SA="voyage-pr-checks@${PROJECT}.iam.gserviceaccount.com"

g() { gcloud --project="$PROJECT" --quiet "$@"; }
say() { printf '\n==> %s\n' "$*"; }

# IAM can take a while to recognise a service account that was just created,
# and a binding sent too soon fails with "Service account ... does not exist".
# Retry only that error, and only when it names a service account in this
# call: up to 12 attempts, 5 seconds apart (about 55 seconds of waiting).
# Any other error fails at once. Notices go to stderr, because callers
# discard stdout.
g_iam() {
  local max=12 attempt=1 err arg sa named
  local -a accounts=()
  for arg in "$@"; do
    [[ "$arg" =~ ([A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com) ]] &&
      accounts+=("${BASH_REMATCH[1]}")
  done

  until err=$(g "$@" 2>&1 >/dev/null); do
    named=0
    for sa in ${accounts[@]+"${accounts[@]}"}; do
      [[ "$err" == *"$sa"*"does not exist"* ]] && named=1
    done
    if [[ "$named" == 1 && "$attempt" -lt "$max" ]]; then
      echo "  (service account not visible to IAM yet, retry ${attempt}/$((max - 1)) in 5s)" >&2
      sleep 5
      attempt=$((attempt + 1))
    else
      echo "$err" >&2
      return 1
    fi
  done
}

ensure_sa() {
  local id=$1 name=$2
  if g iam service-accounts describe "${id}@${PROJECT}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    echo "service account ${id} exists"
  else
    g iam service-accounts create "$id" --display-name="$name"
  fi
}

base() {
  say "Checking the active account and project"
  echo "account: $(gcloud config get account 2>/dev/null)"
  [[ "$(gcloud config get project 2>/dev/null)" == "$PROJECT" ]] ||
    { echo "Active project is not ${PROJECT}. Run: gcloud config set project ${PROJECT}"; exit 1; }

  local billing
  billing=$(g billing projects describe "$PROJECT" --format='value(billingAccountName)' | sed 's|billingAccounts/||')
  [[ -n "$billing" ]] || { echo "No billing account linked to ${PROJECT}."; exit 1; }

  say "Enabling APIs (takes a minute)"
  g services enable run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com iam.googleapis.com secretmanager.googleapis.com \
    cloudresourcemanager.googleapis.com billingbudgets.googleapis.com

  say "Artifact Registry repo"
  if g artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
    echo "repo ${AR_REPO} exists"
  else
    g artifacts repositories create "$AR_REPO" --location="$REGION" \
      --repository-format=docker --description="Voyage shortlist images"
  fi

  say "Service accounts"
  ensure_sa voyage-web "Voyage shortlist: Cloud Run runtime"
  ensure_sa voyage-build "Voyage shortlist: Cloud Build deployer"

  say "Least-privilege roles for the build account"
  g_iam projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${BUILD_SA}" \
    --role=roles/logging.logWriter --condition=None >/dev/null
  g_iam projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${BUILD_SA}" \
    --role=roles/run.developer --condition=None >/dev/null
  g_iam artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" \
    --member="serviceAccount:${BUILD_SA}" --role=roles/artifactregistry.writer >/dev/null
  # Lets the build deploy a service that runs as voyage-web, and nothing else.
  g_iam iam service-accounts add-iam-policy-binding "$WEB_SA" \
    --member="serviceAccount:${BUILD_SA}" --role=roles/iam.serviceAccountUser >/dev/null
  echo "done (voyage-web has no roles yet; Phase 1 adds Cloud SQL access)"

  say "Budget alert: £${BUDGET_GBP}/month on billing account ${billing}"
  # Captured first: piping gcloud into `grep -q` can SIGPIPE gcloud, and with
  # pipefail that reads as "no budget", which would create a duplicate.
  local budgets
  budgets=$(g billing budgets list --billing-account="$billing" --format='value(displayName)')
  if grep -qx "tern-floe demo" <<<"$budgets"; then
    echo "budget exists"
  else
    g billing budgets create --billing-account="$billing" --display-name="tern-floe demo" \
      --budget-amount="${BUDGET_GBP}GBP" --filter-projects="projects/${PROJECT}" \
      --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 \
      --threshold-rule=percent=1.0,basis=forecasted-spend
  fi

  say "Base setup complete. Next: bash scripts/gcp-setup.sh connect"
}

cloudbuild_agent() {
  local number
  number=$(g projects describe "$PROJECT" --format='value(projectNumber)')
  echo "serviceAccount:service-${number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}

connect() {
  # Temporary: the agent needs to create the secret that holds the GitHub token.
  # `trigger` swaps this for read access on that one secret.
  say "Temporarily letting the Cloud Build service agent create the GitHub token secret"
  g projects add-iam-policy-binding "$PROJECT" --member="$(cloudbuild_agent)" \
    --role=roles/secretmanager.admin --condition=None >/dev/null

  say "GitHub connection '${CONNECTION}'"
  if g builds connections describe "$CONNECTION" --region="$REGION" >/dev/null 2>&1; then
    echo "connection exists"
  else
    g builds connections create github "$CONNECTION" --region="$REGION"
    echo "Open the URL above and authorise Cloud Build."
  fi
  echo
  echo "State now (needs to say COMPLETE; if not, open the install link it shows):"
  g builds connections describe "$CONNECTION" --region="$REGION" \
    --format='value(installationState.stage,installationState.actionUri)'
  say "When COMPLETE, run: bash scripts/gcp-setup.sh trigger"
}

require_connection_complete() {
  local stage
  stage=$(g builds connections describe "$CONNECTION" --region="$REGION" \
    --format='value(installationState.stage)' 2>/dev/null || true)
  [[ "$stage" == "COMPLETE" ]] ||
    { echo "GitHub connection is ${stage:-missing}, not COMPLETE. Run: bash scripts/gcp-setup.sh connect"; exit 1; }
}

# Shared by `trigger` and `pr-checks`, so either can run first.
ensure_repo_link() {
  require_connection_complete
  if g builds repositories describe "$GH_REPO_NAME" --connection="$CONNECTION" --region="$REGION" >/dev/null 2>&1; then
    echo "repo ${GH_REPO_NAME} already linked"
  else
    local owner
    owner=$(gh api user -q .login)
    say "Linking github.com/${owner}/${GH_REPO_NAME}"
    g builds repositories create "$GH_REPO_NAME" --connection="$CONNECTION" --region="$REGION" \
      --remote-uri="https://github.com/${owner}/${GH_REPO_NAME}.git"
  fi
}

# An existing trigger is checked, not trusted: re-running the script must not
# silently keep a trigger that runs as the wrong account or without the
# /gcbrun gate. A mismatch stops the script with the fix.
verify_trigger() {
  local name=$1 want_sa=$2 want_config=$3 want_comments=${4:-}
  local sa config comments
  sa=$(g builds triggers describe "$name" --region="$REGION" --format='value(serviceAccount)')
  config=$(g builds triggers describe "$name" --region="$REGION" --format='value(filename)')
  local ok=1
  [[ "$sa" == "projects/${PROJECT}/serviceAccounts/${want_sa}" ]] ||
    { echo "MISMATCH ${name}: runs as '${sa}', expected ${want_sa}"; ok=0; }
  [[ "$config" == "$want_config" ]] ||
    { echo "MISMATCH ${name}: build config '${config}', expected ${want_config}"; ok=0; }
  if [[ -n "$want_comments" ]]; then
    comments=$(g builds triggers describe "$name" --region="$REGION" \
      --format='value(repositoryEventConfig.pullRequest.commentControl)')
    [[ "$comments" == "$want_comments" ]] ||
      { echo "MISMATCH ${name}: comment control '${comments}', expected ${want_comments}"; ok=0; }
  fi
  if [[ "$ok" == 1 ]]; then
    echo "trigger ${name} exists and matches"
  else
    echo "Fix: gcloud builds triggers delete ${name} --project=${PROJECT} --region=${REGION}, then re-run this step."
    exit 1
  fi
}

narrow_agent_secret_access() {
  local token_version secret location="" agent admins
  require_connection_complete

  # Global:   projects/123/secrets/github-github-oauthtoken-abc123/versions/1
  # Regional: projects/123/locations/europe-west2/secrets/.../versions/1
  token_version=$(g builds connections describe "$CONNECTION" --region="$REGION" \
    --format='value(githubConfig.authorizerCredential.oauthTokenSecretVersion)')
  echo "token secret version: ${token_version}"
  secret=$(sed -E 's|.*/secrets/([^/]+)/versions/.*|\1|' <<<"$token_version")
  [[ -n "$secret" && "$secret" != "$token_version" ]] ||
    { echo "Couldn't find the GitHub token secret on the connection."; exit 1; }
  if [[ "$token_version" == */locations/*/secrets/* ]]; then
    location=$(sed -E 's|.*/locations/([^/]+)/secrets/.*|\1|' <<<"$token_version")
    [[ "$location" == "global" ]] && location=""
  fi
  if [[ -n "$location" ]]; then
    # Regional secrets are served by the regional Secret Manager endpoint, and
    # the global endpoint rejects their names (seen with gcloud 501). The
    # override is applied to every regional secret and only for this function.
    local -x CLOUDSDK_API_ENDPOINT_OVERRIDES_SECRETMANAGER="https://secretmanager.${location}.rep.googleapis.com/"
  fi
  agent=$(cloudbuild_agent)

  say "Narrowing the Cloud Build agent to read-only access on secret ${secret}${location:+ (${location})}"
  g secrets add-iam-policy-binding "$secret" ${location:+--location="$location"} \
    --member="$agent" --role=roles/secretmanager.secretAccessor >/dev/null

  # Remove the temporary project-wide role only if it's there, and let any
  # real failure stop the script rather than report a false "done".
  admins=$(g projects get-iam-policy "$PROJECT" --flatten="bindings[]" \
    --filter="bindings.role=roles/secretmanager.admin" --format='value(bindings.members)')
  if grep -qF "$agent" <<<"$admins"; then
    g projects remove-iam-policy-binding "$PROJECT" --member="$agent" \
      --role=roles/secretmanager.admin --condition=None >/dev/null
    echo "removed project-wide secretmanager.admin"
  else
    echo "project-wide secretmanager.admin already removed"
  fi
  echo "done: the agent can no longer read other secrets, such as the Anthropic key"
}

trigger() {
  narrow_agent_secret_access
  ensure_repo_link

  say "Push-to-main trigger"
  if g builds triggers describe deploy-main --region="$REGION" >/dev/null 2>&1; then
    verify_trigger deploy-main "$BUILD_SA" cloudbuild.yaml
  else
    g builds triggers create github --name=deploy-main --region="$REGION" \
      --repository="projects/${PROJECT}/locations/${REGION}/connections/${CONNECTION}/repositories/${GH_REPO_NAME}" \
      --branch-pattern='^main$' --build-config=cloudbuild.yaml \
      --service-account="projects/${PROJECT}/serviceAccounts/${BUILD_SA}" \
      --description="Typecheck, test, build and deploy on push to main"
  fi
  say "Trigger ready. Run it now with: gcloud builds triggers run deploy-main --region=${REGION} --branch=main"
}

public() {
  say "Allowing unauthenticated access to ${SERVICE} (public demo)"
  g run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
    --member=allUsers --role=roles/run.invoker >/dev/null
  g run services describe "$SERVICE" --region="$REGION" --format='value(status.url)'
}

pr_checks() {
  # cloudbuild-pr.yaml is read from the PR's own branch, so anyone opening a
  # PR controls the steps. The account it runs as is granted only log writing
  # here (keep it that way), and external contributors' PRs wait for the
  # owner's /gcbrun comment.
  ensure_repo_link

  say "PR checks account (log writing only)"
  ensure_sa voyage-pr-checks "Voyage shortlist: PR checks (no deploy, no secrets)"
  g_iam projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${PR_SA}" \
    --role=roles/logging.logWriter --condition=None >/dev/null

  say "PR checks trigger"
  if g builds triggers describe pr-checks --region="$REGION" >/dev/null 2>&1; then
    verify_trigger pr-checks "$PR_SA" cloudbuild-pr.yaml COMMENTS_ENABLED_FOR_EXTERNAL_CONTRIBUTORS_ONLY
  else
    g builds triggers create github --name=pr-checks --region="$REGION" \
      --repository="projects/${PROJECT}/locations/${REGION}/connections/${CONNECTION}/repositories/${GH_REPO_NAME}" \
      --pull-request-pattern='^main$' \
      --comment-control=COMMENTS_ENABLED_FOR_EXTERNAL_CONTRIBUTORS_ONLY \
      --build-config=cloudbuild-pr.yaml \
      --service-account="projects/${PROJECT}/serviceAccounts/${PR_SA}" \
      --description="Typecheck, lint and test on pull requests to main"
  fi
  say "PR checks ready. Open a PR to main and note the exact check name GitHub shows; that name is what protect-main should require."
}

case "${1:-}" in
  base | connect | trigger | public) "$1" ;;
  pr-checks) pr_checks ;;
  *) sed -n '5,10p' "$0"; exit 1 ;;
esac
