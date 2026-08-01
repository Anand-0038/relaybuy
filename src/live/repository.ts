import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { JSONValue, Sql, TransactionSql } from "postgres";

import { ensureLiveSchema, getLiveSql } from "./db";
import { createMerchantAttemptDigest } from "./operations";
import {
  transitionLiveWorkflow,
  type LiveWorkflowEvent,
} from "./state-machine";
import {
  approvalArtifactSchema,
  auditEventSchema,
  evidenceBundleSchema,
  livePravaSessionSchema,
  liveRequestStateSchema,
  policyDecisionSchema,
  purchaseIntentSchema,
  verifiedMerchantOfferSchema,
  type ApprovalArtifact,
  type AuditEvent,
  type EvidenceBundle,
  type LiveRequestSnapshot,
  type LiveRequestState,
  type LivePravaSession,
  type PolicyDecision,
  type PurchaseIntent,
  type VerifiedMerchantOffer,
} from "./types";

type LiveSql = Sql | TransactionSql;

interface LiveRequestRow {
  approvalArtifact: unknown | null;
  approvalArtifactHash: string | null;
  approvalExpiresAt: Date | null;
  approvalUsedAt: Date | null;
  createdAt: Date;
  evidence: unknown | null;
  expiresAt: Date;
  id: string;
  intent: unknown | null;
  offer: unknown | null;
  policyDecision: unknown | null;
  prava: unknown | null;
  publicId: string;
  requestText: string;
  source: "linq" | "web";
  state: string;
  updatedAt: Date;
  version: number;
}

interface AuditRow {
  actorType: AuditEvent["actorType"];
  createdAt: Date;
  eventType: string;
  payload: Record<string, unknown>;
  sequence: number;
}

interface OperationRow {
  status: string;
}

export type LiveRepositoryErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "EXPIRED"
  | "TOKEN_USED"
  | "UNAUTHORIZED";

export class LiveRepositoryError extends Error {
  constructor(
    public readonly code: LiveRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LiveRepositoryError";
  }
}

function toIso(value: Date): string {
  return value.toISOString();
}

function createPublicId(): string {
  return `RB-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function requireUpdated(row: { version: number } | undefined): void {
  if (!row) {
    throw new LiveRepositoryError(
      "CONFLICT",
      "The purchase request changed concurrently",
    );
  }
}

function requireOperationUpdated(row: { id: string } | undefined): void {
  if (!row) {
    throw new LiveRepositoryError(
      "CONFLICT",
      "The durable external operation record was not in the expected state",
    );
  }
}

async function getLockedRow(
  sql: LiveSql,
  requestId: string,
): Promise<LiveRequestRow> {
  const [row] = await sql<LiveRequestRow[]>`
    SELECT *
    FROM relaybuy_live_requests
    WHERE id = ${requestId}
    FOR UPDATE
  `;
  if (!row) {
    throw new LiveRepositoryError("NOT_FOUND", "Purchase request not found");
  }
  const terminalStates = new Set([
    "approval_invalidated",
    "credential_window_lost",
    "expired",
    "failed",
    "merchant_blocked",
    "merchant_declined_test_card",
    "prava_terminal_observed",
    "report_failed",
    "reported",
    "reporting_outcome",
  ]);
  if (row.expiresAt <= new Date() && !terminalStates.has(row.state)) {
    throw new LiveRepositoryError("EXPIRED", "Purchase request has expired");
  }
  return row;
}

async function addAuditEvent(
  sql: LiveSql,
  requestId: string,
  eventType: string,
  actorType: AuditEvent["actorType"],
  payload: Record<string, unknown>,
  createdAt: Date,
): Promise<void> {
  await sql`
    INSERT INTO relaybuy_live_audit_events (
      request_id,
      sequence,
      event_type,
      actor_type,
      payload,
      created_at
    )
    SELECT
      live_request.id,
      live_request.version,
      ${eventType},
      ${actorType},
      ${sql.json(toJsonValue(payload))},
      ${createdAt}
    FROM relaybuy_live_requests AS live_request
    WHERE live_request.id = ${requestId}
  `;
}

async function loadSnapshotWithSql(
  sql: LiveSql,
  requestId: string,
): Promise<LiveRequestSnapshot> {
  const [row] = await sql<LiveRequestRow[]>`
    SELECT *
    FROM relaybuy_live_requests
    WHERE id = ${requestId}
  `;
  if (!row) {
    throw new LiveRepositoryError("NOT_FOUND", "Purchase request not found");
  }
  const auditRows = await sql<AuditRow[]>`
    SELECT sequence, event_type, actor_type, payload, created_at
    FROM relaybuy_live_audit_events
    WHERE request_id = ${requestId}
    ORDER BY sequence ASC
  `;

  const artifact = row.approvalArtifact
    ? approvalArtifactSchema.parse(row.approvalArtifact)
    : null;

  return {
    approval:
      artifact && row.approvalArtifactHash && row.approvalExpiresAt
        ? {
            approvedAt: row.approvalUsedAt ? toIso(row.approvalUsedAt) : null,
            artifact,
            artifactHash: row.approvalArtifactHash,
            expiresAt: toIso(row.approvalExpiresAt),
          }
        : null,
    audit: auditRows.map((event) =>
      auditEventSchema.parse({
        ...event,
        createdAt: toIso(event.createdAt),
      }),
    ),
    createdAt: toIso(row.createdAt),
    evidence: row.evidence ? evidenceBundleSchema.parse(row.evidence) : null,
    expiresAt: toIso(row.expiresAt),
    id: row.id,
    intent: row.intent ? purchaseIntentSchema.parse(row.intent) : null,
    offer: row.offer ? verifiedMerchantOfferSchema.parse(row.offer) : null,
    policyDecision: row.policyDecision
      ? policyDecisionSchema.parse(row.policyDecision)
      : null,
    prava: row.prava ? livePravaSessionSchema.parse(row.prava) : null,
    publicId: row.publicId,
    requestText: row.requestText,
    source: row.source,
    state: liveRequestStateSchema.parse(row.state),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

function nextState(
  row: LiveRequestRow,
  event: LiveWorkflowEvent,
): LiveRequestState {
  return transitionLiveWorkflow(liveRequestStateSchema.parse(row.state), event);
}

export class LiveRequestRepository {
  async create(input: {
    expiresAt: Date;
    requestText: string;
    requestTokenHash: string;
    source: "linq" | "web";
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    const id = randomUUID();
    const now = new Date();

    return sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO relaybuy_live_requests (
          id, public_id, source, state, version, request_text,
          request_token_hash, created_at, updated_at, expires_at
        )
        VALUES (
          ${id}, ${createPublicId()}, ${input.source}, 'draft', 1,
          ${input.requestText}, ${input.requestTokenHash}, ${now}, ${now},
          ${input.expiresAt}
        )
      `;
      await addAuditEvent(
        transaction,
        id,
        "request.created",
        "user",
        { source: input.source },
        now,
      );
      return loadSnapshotWithSql(transaction, id);
    });
  }

  async getById(requestId: string): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    return loadSnapshotWithSql(getLiveSql(), requestId);
  }

  async getByRequestTokenHash(tokenHash: string): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    const [row] = await sql<{ id: string }[]>`
      SELECT id
      FROM relaybuy_live_requests
      WHERE request_token_hash = ${tokenHash}
    `;
    if (!row) {
      throw new LiveRepositoryError("NOT_FOUND", "Purchase request not found");
    }
    return loadSnapshotWithSql(sql, row.id);
  }

  async saveExtraction(input: {
    intent: PurchaseIntent;
    model: string;
    requestId: string;
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, input.requestId);
      const state = nextState(row, "extraction_succeeded");
      const now = new Date();

      await transaction`
        INSERT INTO relaybuy_live_extractions (
          id, request_id, model, schema_version, payload, created_at
        )
        VALUES (
          ${randomUUID()}, ${input.requestId}, ${input.model}, '2026-07-29',
          ${transaction.json(input.intent)}, ${now}
        )
        ON CONFLICT (request_id) DO NOTHING
      `;
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET
          state = ${state},
          version = version + 1,
          intent = ${transaction.json(input.intent)},
          updated_at = ${now}
        WHERE id = ${input.requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await addAuditEvent(
        transaction,
        input.requestId,
        "openai.extraction_succeeded",
        "openai",
        {
          confidence: input.intent.confidence,
          missingFields: input.intent.missingFields,
          model: input.model,
        },
        now,
      );
      return loadSnapshotWithSql(transaction, input.requestId);
    });
  }

  async saveEvidence(input: {
    evidence: EvidenceBundle;
    offer: VerifiedMerchantOffer;
    requestId: string;
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, input.requestId);
      const state = nextState(row, "evidence_resolved");
      const now = new Date();
      const searches = [input.evidence.merchant, input.evidence.variant];

      for (const search of searches) {
        for (const citation of search.citations) {
          await transaction`
            INSERT INTO relaybuy_live_evidence_items (
              id, request_id, kind, query, answer, title, chunk_text,
              score, rank, content_id, version_id, chunk_index,
              source_type, created_at
            )
            VALUES (
              ${citation.id}, ${input.requestId}, ${search.kind},
              ${search.query}, ${search.answer}, ${citation.title},
              ${citation.chunkText}, ${citation.score}, ${citation.rank},
              ${citation.contentId}, ${citation.versionId},
              ${citation.chunkIndex}, ${citation.sourceType}, ${now}
            )
            ON CONFLICT (id) DO NOTHING
          `;
        }
      }

      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET
          state = ${state},
          version = version + 1,
          evidence = ${transaction.json(input.evidence)},
          offer = ${transaction.json(input.offer)},
          updated_at = ${now}
        WHERE id = ${input.requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await addAuditEvent(
        transaction,
        input.requestId,
        "senso.evidence_resolved",
        "senso",
        {
          merchantCitations: input.evidence.merchant.citations.length,
          offerSource: input.offer.source,
          variantCitations: input.evidence.variant.citations.length,
        },
        now,
      );
      return loadSnapshotWithSql(transaction, input.requestId);
    });
  }

  async savePolicyDecision(input: {
    decision: PolicyDecision;
    requestId: string;
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, input.requestId);
      const event =
        input.decision.status === "pass"
          ? "approval_requested"
          : "policy_refused";
      const state = nextState(row, event);
      const now = new Date();

      await transaction`
        INSERT INTO relaybuy_live_policy_decisions (
          id, request_id, status, reason_code, payload, input_hash, created_at
        )
        VALUES (
          ${randomUUID()}, ${input.requestId}, ${input.decision.status},
          ${input.decision.reasonCode}, ${transaction.json(input.decision)},
          ${hashJson({
            evidence: row.evidence,
            intent: row.intent,
            offer: row.offer,
          })},
          ${now}
        )
        ON CONFLICT (request_id) DO NOTHING
      `;
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET
          state = ${state},
          version = version + 1,
          policy_decision = ${transaction.json(input.decision)},
          updated_at = ${now}
        WHERE id = ${input.requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await addAuditEvent(
        transaction,
        input.requestId,
        input.decision.status === "pass" ? "policy.passed" : "policy.refused",
        "code",
        {
          reasonCode: input.decision.reasonCode,
          quoteTotalMinor: input.decision.quoteTotalMinor,
        },
        now,
      );
      return loadSnapshotWithSql(transaction, input.requestId);
    });
  }

  async issueApproval(input: {
    artifact: ApprovalArtifact;
    artifactHash: string;
    expiresAt: Date;
    requestId: string;
    tokenHash: string;
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, input.requestId);
      if (row.state !== "approval_pending") {
        throw new LiveRepositoryError(
          "CONFLICT",
          "Request is not waiting for approval",
        );
      }
      const now = new Date();
      await transaction`
        INSERT INTO relaybuy_live_approval_artifacts (
          id, request_id, artifact, artifact_hash, token_hash,
          status, expires_at, created_at
        )
        VALUES (
          ${randomUUID()}, ${input.requestId},
          ${transaction.json(input.artifact)}, ${input.artifactHash},
          ${input.tokenHash}, 'pending', ${input.expiresAt}, ${now}
        )
      `;
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET
          version = version + 1,
          approval_artifact = ${transaction.json(input.artifact)},
          approval_artifact_hash = ${input.artifactHash},
          approval_token_hash = ${input.tokenHash},
          approval_expires_at = ${input.expiresAt},
          updated_at = ${now}
        WHERE id = ${input.requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await addAuditEvent(
        transaction,
        input.requestId,
        "approval.issued",
        "system",
        {
          artifactHash: input.artifactHash,
          expiresAt: input.expiresAt.toISOString(),
        },
        now,
      );
      return loadSnapshotWithSql(transaction, input.requestId);
    });
  }

  async getByApprovalTokenHash(
    tokenHash: string,
  ): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    const [row] = await sql<{ id: string }[]>`
      SELECT id
      FROM relaybuy_live_requests
      WHERE approval_token_hash = ${tokenHash}
    `;
    if (!row) {
      throw new LiveRepositoryError("NOT_FOUND", "Approval link not found");
    }
    return loadSnapshotWithSql(sql, row.id);
  }

  async consumeApproval(tokenHash: string): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const [found] = await transaction<LiveRequestRow[]>`
        SELECT *
        FROM relaybuy_live_requests
        WHERE approval_token_hash = ${tokenHash}
        FOR UPDATE
      `;
      if (!found) {
        throw new LiveRepositoryError("NOT_FOUND", "Approval link not found");
      }
      if (found.approvalUsedAt) {
        throw new LiveRepositoryError(
          "TOKEN_USED",
          "Approval link has already been used",
        );
      }
      if (
        found.expiresAt <= new Date() ||
        !found.approvalExpiresAt ||
        found.approvalExpiresAt <= new Date()
      ) {
        throw new LiveRepositoryError("EXPIRED", "Approval link has expired");
      }
      const state = nextState(found, "approval_consumed");
      const now = new Date();
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET
          state = ${state},
          version = version + 1,
          approval_used_at = ${now},
          updated_at = ${now}
        WHERE id = ${found.id} AND version = ${found.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await transaction`
        UPDATE relaybuy_live_approval_artifacts
        SET status = 'approved', used_at = ${now}
        WHERE request_id = ${found.id} AND token_hash = ${tokenHash}
      `;
      await addAuditEvent(
        transaction,
        found.id,
        "approval.consumed",
        "user",
        { artifactHash: found.approvalArtifactHash },
        now,
      );
      return loadSnapshotWithSql(transaction, found.id);
    });
  }

  async invalidateApproval(
    requestId: string,
    reason: string,
  ): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, requestId);
      const state = nextState(row, "approval_invalidated");
      const now = new Date();
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET state = ${state}, version = version + 1, updated_at = ${now}
        WHERE id = ${requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await transaction`
        UPDATE relaybuy_live_approval_artifacts
        SET status = 'expired'
        WHERE request_id = ${requestId} AND status IN ('pending', 'approved')
      `;
      await addAuditEvent(
        transaction,
        requestId,
        "approval.invalidated",
        "system",
        { reason },
        now,
      );
      return loadSnapshotWithSql(transaction, requestId);
    });
  }

  async claimPravaSessionOperation(input: {
    artifactHash: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, input.requestId);
      if (
        row.state !== "approved" ||
        row.approvalArtifactHash !== input.artifactHash ||
        row.approvalUsedAt === null
      ) {
        throw new LiveRepositoryError(
          "CONFLICT",
          "The durable session operation does not match a consumed approval",
        );
      }
      const now = new Date();
      const [created] = await transaction<{ id: string }[]>`
        INSERT INTO relaybuy_prava_session_operations (
          id, request_id, artifact_hash, idempotency_key, status,
          created_at, updated_at
        )
        VALUES (
          ${randomUUID()}, ${input.requestId}, ${input.artifactHash},
          ${input.idempotencyKey}, 'creating', ${now}, ${now}
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (!created) {
        const [operation] = await transaction<OperationRow[]>`
          SELECT status
          FROM relaybuy_prava_session_operations
          WHERE request_id = ${input.requestId}
             OR artifact_hash = ${input.artifactHash}
             OR idempotency_key = ${input.idempotencyKey}
          FOR UPDATE
        `;
        if (operation?.status === "created" && row.prava) {
          return loadSnapshotWithSql(transaction, input.requestId);
        }
        if (operation?.status === "failed") {
          const [retried] = await transaction<{ id: string }[]>`
            UPDATE relaybuy_prava_session_operations
            SET status = 'creating', updated_at = ${now}
            WHERE request_id = ${input.requestId}
              AND artifact_hash = ${input.artifactHash}
              AND idempotency_key = ${input.idempotencyKey}
              AND status = 'failed'
            RETURNING id
          `;
          requireOperationUpdated(retried);
          const [updated] = await transaction<{ version: number }[]>`
            UPDATE relaybuy_live_requests
            SET version = version + 1, updated_at = ${now}
            WHERE id = ${input.requestId} AND version = ${row.version}
            RETURNING version
          `;
          requireUpdated(updated);
          await addAuditEvent(
            transaction,
            input.requestId,
            "prava.session_creation_retried",
            "system",
            {
              artifactHash: input.artifactHash,
              idempotencyKey: input.idempotencyKey,
            },
            now,
          );
          return loadSnapshotWithSql(transaction, input.requestId);
        }
        throw new LiveRepositoryError(
          "CONFLICT",
          operation?.status === "unknown"
            ? "A prior Prava session creation has an unknown remote outcome and requires reconciliation"
            : "A Prava session creation is already in progress",
        );
      }

      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET version = version + 1, updated_at = ${now}
        WHERE id = ${input.requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await addAuditEvent(
        transaction,
        input.requestId,
        "prava.session_creation_claimed",
        "system",
        {
          artifactHash: input.artifactHash,
          idempotencyKey: input.idempotencyKey,
        },
        now,
      );
      return loadSnapshotWithSql(transaction, input.requestId);
    });
  }

  async markPravaSessionOperationUnknown(
    requestId: string,
  ): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, requestId);
      const now = new Date();
      const [operation] = await transaction<{ id: string }[]>`
        UPDATE relaybuy_prava_session_operations
        SET status = 'unknown', updated_at = ${now}
        WHERE request_id = ${requestId} AND status = 'creating'
        RETURNING id
      `;
      requireOperationUpdated(operation);
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET version = version + 1, updated_at = ${now}
        WHERE id = ${requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await addAuditEvent(
        transaction,
        requestId,
        "prava.session_creation_unknown",
        "system",
        {},
        now,
      );
      return loadSnapshotWithSql(transaction, requestId);
    });
  }

  async markPravaSessionOperationFailed(input: {
    requestId: string;
    status?: number;
    vendorCode?: string;
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, input.requestId);
      const now = new Date();
      const [operation] = await transaction<{ id: string }[]>`
        UPDATE relaybuy_prava_session_operations
        SET status = 'failed', updated_at = ${now}
        WHERE request_id = ${input.requestId} AND status = 'creating'
        RETURNING id
      `;
      requireOperationUpdated(operation);
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET version = version + 1, updated_at = ${now}
        WHERE id = ${input.requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await addAuditEvent(
        transaction,
        input.requestId,
        "prava.session_creation_rejected",
        "prava",
        {
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.vendorCode === undefined
            ? {}
            : { vendorCode: input.vendorCode }),
        },
        now,
      );
      return loadSnapshotWithSql(transaction, input.requestId);
    });
  }

  async savePravaSession(input: {
    prava: LivePravaSession;
    requestId: string;
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, input.requestId);
      const state = nextState(row, "prava_session_created");
      const now = new Date();
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET
          state = ${state},
          version = version + 1,
          prava = ${transaction.json(toJsonValue(input.prava))},
          updated_at = ${now}
        WHERE id = ${input.requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      const [operation] = await transaction<{ id: string }[]>`
        UPDATE relaybuy_prava_session_operations
        SET status = 'created', updated_at = ${now}
        WHERE request_id = ${input.requestId} AND status = 'creating'
        RETURNING id
      `;
      requireOperationUpdated(operation);
      await addAuditEvent(
        transaction,
        input.requestId,
        "prava.session_created",
        "prava",
        {
          claim: input.prava.claim,
          expiresAt: input.prava.expiresAt,
          mode: input.prava.mode,
        },
        now,
      );
      return loadSnapshotWithSql(transaction, input.requestId);
    });
  }

  async beginOutcomeReport(input: {
    idempotencyKey: string;
    merchantAttemptDigest: string;
    requestId: string;
    txnRefId: string;
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, input.requestId);
      const currentPrava = livePravaSessionSchema.parse(row.prava);
      if (
        row.state !== "merchant_declined_test_card" ||
        currentPrava.txnRefId !== input.txnRefId ||
        !currentPrava.merchantAttempt ||
        createMerchantAttemptDigest(currentPrava.merchantAttempt) !==
          input.merchantAttemptDigest
      ) {
        throw new LiveRepositoryError(
          "CONFLICT",
          "The outcome report does not match the persisted merchant attempt",
        );
      }
      const state = nextState(row, "prava_report_started");
      const now = new Date();

      const [created] = await transaction<{ id: string }[]>`
        INSERT INTO relaybuy_prava_outcome_reports (
          id, request_id, txn_ref_id, merchant_attempt_digest,
          idempotency_key, status, created_at, updated_at
        )
        VALUES (
          ${randomUUID()}, ${input.requestId}, ${input.txnRefId},
          ${input.merchantAttemptDigest}, ${input.idempotencyKey},
          'reporting', ${now}, ${now}
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (!created) {
        throw new LiveRepositoryError(
          "CONFLICT",
          "This merchant outcome already has a durable report operation",
        );
      }

      const prava = row.prava
        ? livePravaSessionSchema.parse({
            ...currentPrava,
            reportOperation: {
              idempotencyKey: input.idempotencyKey,
              status: "reporting",
              updatedAt: now.toISOString(),
            },
            updatedAt: now.toISOString(),
          })
        : null;
      if (!prava) {
        throw new LiveRepositoryError(
          "CONFLICT",
          "A Prava session is required before outcome reporting",
        );
      }
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET
          state = ${state},
          version = version + 1,
          prava = ${transaction.json(toJsonValue(prava))},
          updated_at = ${now}
        WHERE id = ${input.requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await addAuditEvent(
        transaction,
        input.requestId,
        "prava.outcome_report_started",
        "prava",
        { idempotencyKey: input.idempotencyKey },
        now,
      );
      return loadSnapshotWithSql(transaction, input.requestId);
    });
  }

  async completeOutcomeReport(input: {
    prava: LivePravaSession;
    requestId: string;
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, input.requestId);
      const state = nextState(row, "prava_reported");
      const now = new Date();
      const [operation] = await transaction<{ id: string }[]>`
        UPDATE relaybuy_prava_outcome_reports
        SET status = 'reported', updated_at = ${now}
        WHERE request_id = ${input.requestId} AND status = 'reporting'
        RETURNING id
      `;
      requireOperationUpdated(operation);
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET state = ${state}, version = version + 1,
            prava = ${transaction.json(toJsonValue(input.prava))},
            updated_at = ${now}
        WHERE id = ${input.requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await addAuditEvent(
        transaction,
        input.requestId,
        "prava.outcome_reported",
        "prava",
        {
          txnStatus: input.prava.report?.txnStatus,
          visaConfirmation: input.prava.report?.visaConfirmation,
        },
        now,
      );
      return loadSnapshotWithSql(transaction, input.requestId);
    });
  }

  async savePravaReconciliation(input: {
    event: LiveWorkflowEvent | null;
    prava: LivePravaSession;
    requestId: string;
  }): Promise<LiveRequestSnapshot> {
    await ensureLiveSchema();
    const sql = getLiveSql();
    return sql.begin(async (transaction) => {
      const row = await getLockedRow(transaction, input.requestId);
      const state = input.event
        ? nextState(row, input.event)
        : liveRequestStateSchema.parse(row.state);
      const now = new Date();
      const [updated] = await transaction<{ version: number }[]>`
        UPDATE relaybuy_live_requests
        SET
          state = ${state},
          version = version + 1,
          prava = ${transaction.json(toJsonValue(input.prava))},
          updated_at = ${now}
        WHERE id = ${input.requestId} AND version = ${row.version}
        RETURNING version
      `;
      requireUpdated(updated);
      await addAuditEvent(
        transaction,
        input.requestId,
        "prava.status_reconciled",
        "prava",
        {
          credentialsReady: input.prava.credentialsReady,
          status: input.prava.status,
          txnRefId: input.prava.txnRefId,
        },
        now,
      );
      return loadSnapshotWithSql(transaction, input.requestId);
    });
  }
}
