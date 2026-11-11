-- Phase 3: briefs the specialist checked, every shortlist run, and the
-- per-IP rate limit for the public demo. No commission or margin data.

CREATE TABLE briefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_notes   text NOT NULL,
  -- The checked Brief (src/domain/brief.ts), validated before it is written.
  criteria    jsonb NOT NULL,
  -- A short label for the saved-briefs list, from the party description.
  title       text NOT NULL DEFAULT '',
  saved       boolean NOT NULL DEFAULT false,
  saved_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX briefs_saved_idx ON briefs (saved_at DESC) WHERE saved;

-- Every ranking run, for checking quality and cost. Token counts are summed
-- over the call's attempts (a retry after invalid IDs is a second attempt).
CREATE TABLE shortlists (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id            uuid NOT NULL REFERENCES briefs (id) ON DELETE CASCADE,
  candidate_ids       text[] NOT NULL,
  -- The rendered Shortlist, or null when the run failed.
  result              jsonb,
  failure_kind        text,
  model               text,
  attempts            integer NOT NULL DEFAULT 0,
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  cache_read_tokens   integer NOT NULL DEFAULT 0,
  cache_write_tokens  integer NOT NULL DEFAULT 0,
  latency_ms          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shortlists_brief_idx ON shortlists (brief_id, created_at DESC);

-- Departures a saved brief has already had as candidates, so the nightly job
-- only reports genuinely new ones (see DECISIONS.md, "what counts as a match").
CREATE TABLE brief_known_departures (
  brief_id      uuid NOT NULL REFERENCES briefs (id) ON DELETE CASCADE,
  departure_id  text NOT NULL REFERENCES departures (id) ON DELETE CASCADE,
  PRIMARY KEY (brief_id, departure_id)
);

-- Written by the nightly job (Phase 4), read by "New matches".
CREATE TABLE matches (
  brief_id      uuid NOT NULL REFERENCES briefs (id) ON DELETE CASCADE,
  departure_id  text NOT NULL REFERENCES departures (id) ON DELETE CASCADE,
  found_at      timestamptz NOT NULL DEFAULT now(),
  seen          boolean NOT NULL DEFAULT false,
  PRIMARY KEY (brief_id, departure_id)
);

-- Fixed-window counters. `key` is "ip:<sha256 of the address>" or "global",
-- so no raw IP address is stored.
CREATE TABLE rate_limits (
  key           text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL,
  PRIMARY KEY (key, window_start)
);
