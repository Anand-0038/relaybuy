"use client";

import { useState } from "react";

import type { LiveRequestSnapshot } from "@/live/types";
import {
  getPravaSessionNotCreatedMessage,
  type SandboxPaymentAvailability,
} from "@/live/payment-readiness";

import styles from "./live-console.module.css";

const authorizedRequest = [
  "Buy 1 Bones Coffee Company gift card.",
  "I need the $10.00 denomination as an e-gift card.",
  "Keep the total at or below $10.00 USD and use an approved merchant only.",
].join(" ");

const refusalRequest = [
  "Buy 1 Bones Coffee Company gift card.",
  "I need the $25.00 denomination as an e-gift card.",
  "The maximum authorized budget is $10.00 USD.",
  "Use an approved merchant only.",
].join(" ");

type DemoScenario = "authorized" | "custom" | "refusal";

interface ApiErrorShape {
  error?: { message?: string };
}

async function post<T>(
  url: string,
  body?: unknown,
  capability?: string,
): Promise<T> {
  const init: RequestInit = { method: "POST" };

  if (capability) {
    init.headers = { Authorization: `Bearer ${capability}` };
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = {
      ...init.headers,
      "Content-Type": "application/json",
    };
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(
      "RelayBuy API is unreachable. Reload after confirming the local server is running.",
      { cause: error },
    );
  }

  let payload: T & ApiErrorShape;
  try {
    payload = (await response.json()) as T & ApiErrorShape;
  } catch (error) {
    throw new Error(
      `RelayBuy API returned an invalid response (${response.status}). Reload the app and try once more.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `Request failed with ${response.status}`,
    );
  }
  return payload;
}

function money(value: number | null, currency = "USD"): string {
  if (value === null) {
    return "Missing";
  }
  return new Intl.NumberFormat("en-US", {
    currency,
    style: "currency",
  }).format(value / 100);
}

export function LiveConsole({
  paymentAvailability,
}: {
  paymentAvailability: SandboxPaymentAvailability;
}) {
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requestText, setRequestText] = useState(refusalRequest);
  const [scenario, setScenario] = useState<DemoScenario>("refusal");
  const [requestCapability, setRequestCapability] = useState<string | null>(
    null,
  );
  const [snapshot, setSnapshot] = useState<LiveRequestSnapshot | null>(null);
  const [stage, setStage] = useState("Ready");

  function selectScenario(nextScenario: Exclude<DemoScenario, "custom">) {
    setApprovalUrl(null);
    setClarificationAnswer("");
    setError(null);
    setRequestCapability(null);
    setRequestText(
      nextScenario === "refusal" ? refusalRequest : authorizedRequest,
    );
    setScenario(nextScenario);
    setSnapshot(null);
    setStage(
      nextScenario === "refusal"
        ? "Ready to prove refusal"
        : "Ready to prove exact authorization",
    );
  }

  async function completeEvidencePath(
    request: LiveRequestSnapshot,
    capability: string,
  ) {
    setStage("Senso resolving cited evidence");
    let result = await post<{ request: LiveRequestSnapshot }>(
      `/api/live/requests/${request.id}/evidence`,
      undefined,
      capability,
    );
    setSnapshot(result.request);

    setStage("Code evaluating hard gates");
    result = await post<{ request: LiveRequestSnapshot }>(
      `/api/live/requests/${request.id}/evaluate`,
      undefined,
      capability,
    );
    setSnapshot(result.request);
    setStage(
      result.request.state === "refused"
        ? "Refused before payment"
        : "Ready for artifact approval",
    );
  }

  async function runWorkflow() {
    setBusy(true);
    setError(null);
    setApprovalUrl(null);
    try {
      setStage("Persisting request");
      const created = await post<{
        request: LiveRequestSnapshot;
        requestCapability: string;
      }>("/api/live/requests", { requestText, source: "web" });
      const capability = created.requestCapability;
      setRequestCapability(capability);
      let result = { request: created.request };
      setSnapshot(created.request);

      setStage("OpenAI extracting typed intent");
      result = await post<{ request: LiveRequestSnapshot }>(
        `/api/live/requests/${result.request.id}/extract`,
        undefined,
        capability,
      );
      setSnapshot(result.request);
      if (result.request.state === "clarification_required") {
        setStage("One clarification required");
        return;
      }
      await completeEvidencePath(result.request, capability);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workflow failed");
      setStage("Failed closed");
    } finally {
      setBusy(false);
    }
  }

  async function answerClarification() {
    if (!snapshot || !requestCapability || !clarificationAnswer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setStage("Applying clarification");
      let result = await post<{ request: LiveRequestSnapshot }>(
        `/api/live/requests/${snapshot.id}/clarification`,
        { answer: clarificationAnswer },
        requestCapability,
      );
      setSnapshot(result.request);
      setStage("OpenAI re-extracting complete intent");
      result = await post<{ request: LiveRequestSnapshot }>(
        `/api/live/requests/${snapshot.id}/extract`,
        undefined,
        requestCapability,
      );
      setSnapshot(result.request);
      setClarificationAnswer("");
      if (result.request.state === "clarification_required") {
        setStage("One more hard field is required");
        return;
      }
      await completeEvidencePath(result.request, requestCapability);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Clarification failed",
      );
      setStage("Failed closed");
    } finally {
      setBusy(false);
    }
  }

  async function createApproval() {
    if (!snapshot || !requestCapability) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setStage("Creating hash-bound approval");
      const result = await post<{
        approvalUrl: string;
        request: LiveRequestSnapshot;
      }>(
        `/api/live/requests/${snapshot.id}/approval`,
        undefined,
        requestCapability,
      );
      setSnapshot(result.request);
      setApprovalUrl(result.approvalUrl);
      setStage("Approval link issued");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Approval failed");
      setStage("Failed closed");
    } finally {
      setBusy(false);
    }
  }

  const intent = snapshot?.intent;
  const offer = snapshot?.offer;
  const decision = snapshot?.policyDecision;
  const citations = snapshot
    ? [
        ...(snapshot.evidence?.merchant.citations ?? []),
        ...(snapshot.evidence?.variant.citations ?? []),
      ]
    : [];

  return (
    <main className={styles.livePage}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>SANDBOX — PAYMENT MECHANICS ONLY</p>
          <h1>Proof before purchase.</h1>
          <p className={styles.lede}>
            The model extracts. Code decides. Humans approve. Prava authorizes.
          </p>
        </div>
        <div className={styles.statusPanel}>
          <span className={styles.statusDot} />
          <div>
            <strong>{stage}</strong>
            <small>Real integrations only. Fail-closed by default.</small>
          </div>
        </div>
      </section>

      <ol aria-label="RelayBuy trust path" className={styles.trustPath}>
        <li>
          <span>01</span>
          OpenAI understands
        </li>
        <li>
          <span>02</span>
          Merchant + Senso prove
        </li>
        <li>
          <span>03</span>
          Code decides
        </li>
        <li>
          <span>04</span>
          Human approves
        </li>
        <li>
          <span>05</span>
          Prava authorizes
        </li>
      </ol>

      <section className={styles.workspace}>
        <div className={styles.composer}>
          <div className={styles.sectionHeading}>
            <span>01</span>
            <div>
              <h2>Purchase request</h2>
              <p>
                Describe what you need; merchant facts are verified separately.
              </p>
            </div>
          </div>
          <fieldset className={styles.scenarioPicker}>
            <legend>Two-step judge path</legend>
            <button
              aria-pressed={scenario === "refusal"}
              disabled={busy}
              onClick={() => selectScenario("refusal")}
              type="button"
            >
              <strong>1. Refusal proof</strong>
              <span>$25 requested · only $10 authorized</span>
            </button>
            <button
              aria-pressed={scenario === "authorized"}
              disabled={busy}
              onClick={() => selectScenario("authorized")}
              type="button"
            >
              <strong>2. Exact candidate</strong>
              <span>Approved $10 option · human gate next</span>
            </button>
          </fieldset>
          <label htmlFor="purchase-request">Natural-language request</label>
          <textarea
            disabled={busy}
            id="purchase-request"
            onChange={(event) => {
              setRequestText(event.target.value);
              setScenario("custom");
            }}
            rows={9}
            value={requestText}
          />
          <button
            className={styles.primaryButton}
            disabled={busy || requestText.trim().length < 12}
            onClick={runWorkflow}
            type="button"
          >
            {busy
              ? "Running live workflow..."
              : scenario === "refusal"
                ? "Run refusal proof"
                : "Run evidence path"}
          </button>
          <p className={styles.safetyCopy}>
            Prava remains unreachable until the exact artifact is approved.
          </p>
          {snapshot?.state === "clarification_required" &&
          snapshot.clarification ? (
            <div className={styles.clarificationBox}>
              <label htmlFor="clarification-answer">
                {snapshot.clarification.question}
              </label>
              <input
                disabled={busy}
                id="clarification-answer"
                maxLength={500}
                onChange={(event) => setClarificationAnswer(event.target.value)}
                placeholder="Add only the missing purchase constraint"
                value={clarificationAnswer}
              />
              <button
                className={styles.primaryButton}
                disabled={busy || !clarificationAnswer.trim()}
                onClick={answerClarification}
                type="button"
              >
                Continue with clarification
              </button>
            </div>
          ) : null}
          {error ? <p className={styles.errorBanner}>{error}</p> : null}
        </div>

        <div className={styles.results}>
          <div className={styles.resultHeader}>
            <div>
              <p className={styles.eyebrow}>DURABLE REQUEST</p>
              <h2>{snapshot?.publicId ?? "Not started"}</h2>
            </div>
            <span className={styles.stateBadge}>
              {snapshot?.state ?? "draft"}
            </span>
          </div>

          <div className={styles.grid}>
            <article className={styles.card}>
              <p className={styles.cardOwner}>AGENT / DISCOVER + EXTRACT</p>
              <h3>{intent?.requestedProduct ?? "Awaiting extraction"}</h3>
              <dl>
                <div>
                  <dt>Merchant</dt>
                  <dd>{intent?.preferredMerchant ?? "No preference"}</dd>
                </div>
                <div>
                  <dt>Requested option</dt>
                  <dd>
                    {intent?.requestedColor ?? "?"} /{" "}
                    {intent?.requestedSize ?? "?"}
                  </dd>
                </div>
                <div>
                  <dt>Quoted option</dt>
                  <dd>
                    {offer?.quotedColor ?? "?"} / {offer?.quotedSize ?? "?"}
                  </dd>
                </div>
                <div>
                  <dt>SKU</dt>
                  <dd>{offer?.sku ?? "Awaiting merchant"}</dd>
                </div>
                <div>
                  <dt>Live candidates</dt>
                  <dd>{snapshot?.merchantCandidates.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Budget</dt>
                  <dd>
                    {money(intent?.budgetMinor ?? null, intent?.currency)}
                  </dd>
                </div>
              </dl>
              {snapshot?.merchantCandidates.length ? (
                <div className={styles.citationList}>
                  {snapshot.merchantCandidates.map((candidate) => (
                    <div className={styles.citation} key={candidate.sku}>
                      <strong>{candidate.optionLabel}</strong>
                      <span>
                        {money(candidate.totalMinor, candidate.currency)} ·{" "}
                        {candidate.executionEligible
                          ? "trust-eligible"
                          : "discovered, not executable"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>

            <article className={styles.card}>
              <p className={styles.cardOwner}>SENSO / CITED EVIDENCE</p>
              <h3>{citations.length} grounded source chunks</h3>
              <div className={styles.citationList}>
                {citations.length === 0 ? (
                  <p>Evidence appears after the live Senso searches.</p>
                ) : (
                  citations.slice(0, 4).map((citation) => (
                    <div className={styles.citation} key={citation.id}>
                      <strong>{citation.title}</strong>
                      <span>
                        score {citation.score.toFixed(2)} · chunk{" "}
                        {citation.chunkIndex}
                      </span>
                      <p>{citation.chunkText.slice(0, 150)}...</p>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article
              className={`${styles.card} ${
                decision?.status === "refuse" ? styles.refusalCard : ""
              }`}
            >
              <p className={styles.cardOwner}>CODE / HARD GATES</p>
              <h3>{decision?.reasonCode ?? "Awaiting evaluation"}</h3>
              <p>{decision?.reason ?? "No policy decision yet."}</p>
              <ul className={styles.checkList}>
                {decision?.checks.map((check) => (
                  <li data-status={check.status} key={check.code}>
                    <strong>{check.code}</strong>
                    <span>{check.detail}</span>
                  </li>
                ))}
              </ul>
              {decision?.status === "pass" ? (
                <button
                  className={styles.primaryButton}
                  disabled={
                    busy ||
                    Boolean(snapshot?.approval) ||
                    !paymentAvailability.enabled
                  }
                  onClick={createApproval}
                  type="button"
                >
                  {snapshot?.approval
                    ? "Approval already issued"
                    : !paymentAvailability.enabled
                      ? paymentAvailability.reason === "UNKNOWN_OUTCOME_PAUSE"
                        ? "Approval paused: reconcile Prava"
                        : "Approval unavailable: payment runtime disabled"
                      : `Create approval for ${money(
                          decision.quoteTotalMinor,
                          intent?.currency,
                        )}`}
                </button>
              ) : null}
              {decision?.status === "pass" && !paymentAvailability.enabled ? (
                <p className={styles.safetyCopy}>
                  {paymentAvailability.message}
                </p>
              ) : null}
              {approvalUrl ? (
                <a className={styles.approvalLink} href={approvalUrl}>
                  Open artifact approval
                </a>
              ) : null}
            </article>

            <article className={styles.card}>
              <p className={styles.cardOwner}>PRAVA / PAYMENT BOUNDARY</p>
              <h3>{snapshot?.prava?.status ?? "Prava session: not created"}</h3>
              <p>
                {snapshot?.prava
                  ? snapshot.prava.report
                    ? "Merchant decline observed and reported to Prava. No live funds moved and no order was created."
                    : "Sandbox session metadata is durable. Card credentials are never persisted or returned here."
                  : getPravaSessionNotCreatedMessage(paymentAvailability)}
              </p>
              {snapshot?.prava?.approvalUrl ? (
                <a
                  className={styles.approvalLink}
                  href={snapshot.prava.approvalUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open Prava passkey approval
                </a>
              ) : null}
            </article>
          </div>

          <article className={styles.auditCard}>
            <p className={styles.cardOwner}>SEQUENCED AUDIT TRAIL</p>
            <ol>
              {snapshot?.audit.map((event) => (
                <li key={event.sequence}>
                  <span>{String(event.sequence).padStart(2, "0")}</span>
                  <strong>{event.eventType}</strong>
                  <small>{event.actorType}</small>
                </li>
              ))}
            </ol>
          </article>
        </div>
      </section>
    </main>
  );
}
