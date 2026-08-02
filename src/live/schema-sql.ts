export const LIVE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS relaybuy_live_requests (
  id uuid PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('web', 'linq')),
  state text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  request_text text NOT NULL,
  clarification jsonb,
  intent jsonb,
  offer jsonb,
  merchant_candidates jsonb,
  evidence jsonb,
  policy_decision jsonb,
  prava jsonb,
  approval_artifact jsonb,
  approval_artifact_hash text,
  request_token_hash text UNIQUE,
  approval_token_hash text UNIQUE,
  execution_token_hash text UNIQUE,
  execution_expires_at timestamptz,
  approval_expires_at timestamptz,
  approval_used_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

ALTER TABLE relaybuy_live_requests
  ADD COLUMN IF NOT EXISTS prava jsonb;
ALTER TABLE relaybuy_live_requests
  ADD COLUMN IF NOT EXISTS offer jsonb;
ALTER TABLE relaybuy_live_requests
  ADD COLUMN IF NOT EXISTS merchant_candidates jsonb;
ALTER TABLE relaybuy_live_requests
  ADD COLUMN IF NOT EXISTS request_token_hash text;
ALTER TABLE relaybuy_live_requests
  ADD COLUMN IF NOT EXISTS clarification jsonb;
ALTER TABLE relaybuy_live_requests
  ADD COLUMN IF NOT EXISTS execution_token_hash text;
ALTER TABLE relaybuy_live_requests
  ADD COLUMN IF NOT EXISTS execution_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS relaybuy_live_requests_request_token_hash_idx
  ON relaybuy_live_requests(request_token_hash)
  WHERE request_token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS relaybuy_live_requests_execution_token_hash_idx
  ON relaybuy_live_requests(execution_token_hash)
  WHERE execution_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS relaybuy_live_extractions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES relaybuy_live_requests(id),
  model text NOT NULL,
  schema_version text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS relaybuy_live_evidence_items (
  id uuid PRIMARY KEY,
  external_citation_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES relaybuy_live_requests(id),
  kind text NOT NULL CHECK (kind IN ('merchant', 'variant')),
  query text NOT NULL,
  answer text NOT NULL,
  title text NOT NULL,
  chunk_text text NOT NULL,
  score double precision NOT NULL,
  rank integer NOT NULL,
  content_id text NOT NULL,
  version_id text,
  chunk_index integer NOT NULL,
  source_type text NOT NULL,
  created_at timestamptz NOT NULL
);

ALTER TABLE relaybuy_live_evidence_items
  ADD COLUMN IF NOT EXISTS external_citation_id uuid;
UPDATE relaybuy_live_evidence_items
  SET external_citation_id = id
  WHERE external_citation_id IS NULL;
ALTER TABLE relaybuy_live_evidence_items
  ALTER COLUMN external_citation_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS relaybuy_live_evidence_request_citation_idx
  ON relaybuy_live_evidence_items(request_id, kind, external_citation_id);

CREATE TABLE IF NOT EXISTS relaybuy_live_policy_decisions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES relaybuy_live_requests(id),
  status text NOT NULL,
  reason_code text NOT NULL,
  payload jsonb NOT NULL,
  input_hash text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS relaybuy_live_approval_artifacts (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES relaybuy_live_requests(id),
  artifact jsonb NOT NULL,
  artifact_hash text NOT NULL UNIQUE,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS relaybuy_prava_session_operations (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES relaybuy_live_requests(id),
  artifact_hash text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('creating', 'created', 'failed', 'unknown')),
  response_id text,
  http_status integer,
  vendor_code text,
  transport_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE relaybuy_prava_session_operations
  ADD COLUMN IF NOT EXISTS response_id text;
ALTER TABLE relaybuy_prava_session_operations
  ADD COLUMN IF NOT EXISTS http_status integer;
ALTER TABLE relaybuy_prava_session_operations
  ADD COLUMN IF NOT EXISTS vendor_code text;
ALTER TABLE relaybuy_prava_session_operations
  ADD COLUMN IF NOT EXISTS transport_code text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'relaybuy_prava_session_operations'::regclass
      AND conname = 'relaybuy_prava_session_operations_status_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%failed%'
  ) THEN
    ALTER TABLE relaybuy_prava_session_operations
      DROP CONSTRAINT relaybuy_prava_session_operations_status_check;
    ALTER TABLE relaybuy_prava_session_operations
      ADD CONSTRAINT relaybuy_prava_session_operations_status_check
      CHECK (status IN ('creating', 'created', 'failed', 'unknown'));
  END IF;
END $$;

-- Earlier builds persisted the provider operation as unknown but left the
-- request visually approved. Promote those records once so they cannot be
-- mistaken for retryable approvals after an upgrade.
UPDATE relaybuy_live_requests AS request
SET state = 'prava_session_unknown',
    version = request.version + 1,
    updated_at = GREATEST(request.updated_at, operation.updated_at)
FROM relaybuy_prava_session_operations AS operation
WHERE operation.request_id = request.id
  AND operation.status = 'unknown'
  AND request.state = 'approved';

CREATE TABLE IF NOT EXISTS relaybuy_prava_outcome_reports (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES relaybuy_live_requests(id),
  txn_ref_id text NOT NULL,
  merchant_attempt_digest text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('reporting', 'reported', 'report_failed', 'report_unknown')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'relaybuy_prava_outcome_reports'::regclass
      AND conname = 'relaybuy_prava_outcome_reports_status_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%report_unknown%'
  ) THEN
    ALTER TABLE relaybuy_prava_outcome_reports
      DROP CONSTRAINT relaybuy_prava_outcome_reports_status_check;
    ALTER TABLE relaybuy_prava_outcome_reports
      ADD CONSTRAINT relaybuy_prava_outcome_reports_status_check
      CHECK (status IN ('reporting', 'reported', 'report_failed', 'report_unknown'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS relaybuy_live_audit_events (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES relaybuy_live_requests(id),
  sequence integer NOT NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (request_id, sequence)
);

CREATE INDEX IF NOT EXISTS relaybuy_live_requests_state_idx
  ON relaybuy_live_requests(state);
CREATE INDEX IF NOT EXISTS relaybuy_live_audit_request_idx
  ON relaybuy_live_audit_events(request_id, sequence);
CREATE INDEX IF NOT EXISTS relaybuy_live_evidence_request_idx
  ON relaybuy_live_evidence_items(request_id, kind);
`;
