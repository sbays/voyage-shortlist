#!/usr/bin/env bash
# One-off GCP setup for the Tern & Floe voyage shortlist. Safe to re-run:
# each step skips anything that already exists.
#
# Usage, in order:
#   bash scripts/gcp-setup.sh base      # APIs, registry, service accounts, budget
#   bash scripts/gcp-setup.sh connect   # links Cloud Build to GitHub (browser steps)
#   bash scripts/gcp-setup.sh trigger   # push-to-main trigger, once connect is COMPLETE
#   bash scripts/gcp-setup.sh public    # after the first deploy: open the demo to everyone
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

g() { gcloud --project="$PROJECT" --quiet "$@"; }
say() { printf '\n==> %s\n' "$*"; }

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
  g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${BUILD_SA}" \
    --role=roles/logging.logWriter --condition=None >/dev/null
  g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${BUILD_SA}" \
    --role=roles/run.developer --condition=None >/dev/null
  g artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" \
    --member="serviceAccount:${BUILD_SA}" --role=roles/artifactregistry.writer >/dev/null
  # Lets the build deploy a service that runs as voyage-web, and nothing else.
  g iam service-accounts add-iam-policy-binding "$WEB_SA" \
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

narrow_agent_secret_access() {
  local stage token_version secret agent
  stage=$(g builds connections describe "$CONNECTION" --region="$REGION" \
    --format='value(installationState.stage)')
  [[ "$stage" == "COMPLETE" ]] ||
    { echo "Connection is ${stage:-missing}, not COMPLETE. Finish: bash scripts/gcp-setup.sh connect"; exit 1; }

  # e.g. projects/123/secrets/github-github-oauthtoken-abc123/versions/1
  token_version=$(g builds connections describe "$CONNECTION" --region="$REGION" \
    --format='value(githubConfig.authorizerCredential.oauthTokenSecretVersion)')
  secret=$(sed -E 's|.*/secrets/([^/]+)/versions/.*|\1|' <<<"$token_version")
  [[ -n "$secret" && "$secret" != "$token_version" ]] ||
    { echo "Couldn't find the GitHub token secret on the connection."; exit 1; }
  agent=$(cloudbuild_agent)

  say "Narrowing the Cloud Build agent to read-only access on secret ${secret}"
  g secrets add-iam-policy-binding "$secret" --member="$agent" \
    --role=roles/secretmanager.secretAccessor >/dev/null
  g projects remove-iam-policy-binding "$PROJECT" --member="$agent" \
    --role=roles/secretmanager.admin --condition=None >/dev/null 2>&1 ||
    echo "project-wide secretmanager.admin already removed"
  echo "done: the agent can no longer read other secrets, such as the Anthropic key"
}

trigger() {
  narrow_agent_secret_access

  local owner
  owner=$(gh api user -q .login)
  say "Linking github.com/${owner}/${GH_REPO_NAME}"
  if ! g builds repositories describe "$GH_REPO_NAME" --connection="$CONNECTION" --region="$REGION" >/dev/null 2>&1; then
    g builds repositories create "$GH_REPO_NAME" --connection="$CONNECTION" --region="$REGION" \
      --remote-uri="https://github.com/${owner}/${GH_REPO_NAME}.git"
  fi

  say "Push-to-main trigger"
  if g builds triggers describe deploy-main --region="$REGION" >/dev/null 2>&1; then
    echo "trigger exists"
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

case "${1:-}" in
  base | connect | trigger | public) "$1" ;;
  *) sed -n '5,9p' "$0"; exit 1 ;;
esac
