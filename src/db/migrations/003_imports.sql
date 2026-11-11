-- Phase 4: every availability CSV upload, applied or rejected. An import is
-- all or nothing (DECISIONS.md, "CSV import format"), so a rejected file
-- changes no fares and keeps its errors here for the uploader to read.

CREATE TABLE availability_imports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename       text NOT NULL,
  -- Where the uploaded file is kept in Cloud Storage; null in local dev.
  storage_path   text,
  status         text NOT NULL CHECK (status IN ('applied', 'rejected')),
  rows_total     integer NOT NULL,
  rows_updated   integer NOT NULL DEFAULT 0,
  -- [{ "row": 3, "message": "unknown departure dep_999" }, ...]
  errors         jsonb NOT NULL DEFAULT '[]',
  uploaded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX availability_imports_uploaded_idx ON availability_imports (uploaded_at DESC);

-- Runs of the nightly match job, so the "New matches" page can say when
-- matches were last checked.
CREATE TABLE match_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  briefs_checked   integer NOT NULL DEFAULT 0,
  -- Saved briefs skipped because they no longer parse or their search failed.
  briefs_failed    integer NOT NULL DEFAULT 0,
  matches_written  integer NOT NULL DEFAULT 0
);
