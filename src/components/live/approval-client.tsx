"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LiveRequestSnapshot } from "@/live/types";
import type { SandboxPaymentAvailability } from "@/live/payment-readiness";

import styles from "./live-console.module.css";

type PasskeyReadiness = "checking" | "ready" | "unsupported";

export function isUnsupportedPravaWebview(userAgent: string): boolean {
  return /Electron\/|\bCode\/|;\s*wv\)/i.test(userAgent);
}

async function detectPasskeyReadiness(): Promise<PasskeyReadiness> {
  if (isUnsupportedPravaWebview(navigator.userAgent)) {
    return "unsupported";
  }
  const checker =
    globalThis.PublicKeyCredential
      ?.isUserVerifyingPlatformAuthenticatorAvailable;
  if (!checker) {
    return "unsupported";
  }
  try {
    return (await checker.call(globalThis.PublicKeyCredential))
      ? "ready"
      : "unsupported";
  } catch {
    return "unsupported";
  }
}

function pravaApprovalStorageKey(request: LiveRequestSnapshot): string | null {
  return request.prava
    ? `relaybuy:prava-approval-opened:${request.id}:${request.prava.createdAt}`
    : null;
}

export function canReconcilePrava(request: LiveRequestSnapshot): boolean {
  if (!request.prava) {
    return false;
  }
  if (["prava_pending", "credentials_issued"].includes(request.state)) {
    return true;
  }
  return (
    request.state === "reported" &&
    !["completed", "failed"].includes(request.prava.status)
  );
}

export function canReconcileOutcomeReport(
  request: LiveRequestSnapshot,
): boolean {
  return Boolean(
    request.prava &&
    ["reporting_outcome", "report_failed", "report_unknown"].includes(
      request.state,
    ),
  );
}

interface PravaSessionCreationBlock {
  heading: string;
  message: string;
}

export function getPravaSessionCreationBlock(
  request: LiveRequestSnapshot,
): PravaSessionCreationBlock | null {
  const operation = request.pravaSessionOperation;
  if (!operation || operation.status === "failed" || request.prava) {
    return null;
  }
  if (operation.status === "unknown") {
    const transportDetail = operation.transportCode
      ? ` The recorded transport code is ${operation.transportCode}.`
      : "";
    return {
      heading: "Prava session outcome unknown",
      message: `RelayBuy will not retry this artifact because Prava may have received the first request.${transportDetail} Check the Prava dashboard and contact Prava support with the private durable external reference.`,
    };
  }
  if (operation.status === "creating") {
    return {
      heading: "Prava session creation in progress",
      message:
        "RelayBuy has already claimed this external operation. Do not submit it again while its outcome is unresolved.",
    };
  }
  return {
    heading: "Prava session record requires operator review",
    message:
      "The provider operation is marked created but no safe session snapshot is available. Do not retry or continue checkout.",
  };
}

interface ControlledSandboxReceipt {
  artifact: string;
  controlStatus: "Complete" | "Terminal reconciliation pending";
  liveFunds: "None moved";
  merchantAttempt: "Not observed" | "Submitted once";
  merchantOrder: "Not created";
  merchantOutcome: "Declined as expected" | "Not observed";
  outcomeReport: "DECLINED acknowledged" | "Not acknowledged";
  pravaLifecycle: string;
}

export function getControlledSandboxReceipt(
  request: LiveRequestSnapshot,
): ControlledSandboxReceipt | null {
  const prava = request.prava;
  if (!prava?.merchantAttempt && !prava?.report) {
    return null;
  }

  const terminal = ["completed", "failed"].includes(prava.status);
  const artifact = request.approval?.artifact;
  const artifactLabel = artifact
    ? `${new Intl.NumberFormat("en-US", {
        currency: artifact.currency,
        style: "currency",
      }).format(artifact.quoteTotalMinor / 100)} ${artifact.productName}`
    : "Approved artifact";

  return {
    artifact: artifactLabel,
    controlStatus:
      terminal && Boolean(prava.merchantAttempt) && Boolean(prava.report)
        ? "Complete"
        : "Terminal reconciliation pending",
    liveFunds: "None moved",
    merchantAttempt: prava.merchantAttempt ? "Submitted once" : "Not observed",
    merchantOrder: "Not created",
    merchantOutcome: prava.merchantAttempt
      ? "Declined as expected"
      : "Not observed",
    outcomeReport: prava.report ? "DECLINED acknowledged" : "Not acknowledged",
    pravaLifecycle: terminal
      ? `Terminal ${prava.status}`
      : "Terminal reconciliation pending",
  };
}

export function ApprovalClient({
  paymentAvailability,
  token,
}: {
  paymentAvailability: SandboxPaymentAvailability;
  token: string;
}) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passkeyReadiness, setPasskeyReadiness] =
    useState<PasskeyReadiness>("checking");
  const [pravaApprovalOpened, setPravaApprovalOpened] = useState(false);
  const [request, setRequest] = useState<LiveRequestSnapshot | null>(null);
  const automaticExecutionStarted = useRef(false);
  const automaticPollAttempts = useRef(0);

  const updateRequest = useCallback((nextRequest: LiveRequestSnapshot) => {
    const storageKey = pravaApprovalStorageKey(nextRequest);
    setPravaApprovalOpened(
      storageKey ? localStorage.getItem(storageKey) === "true" : false,
    );
    setRequest(nextRequest);
  }, []);

  const loadRequest = useCallback(async (): Promise<LiveRequestSnapshot> => {
    const response = await fetch(`/api/live/approve/${token}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      error?: { message?: string };
      request?: LiveRequestSnapshot;
    };
    if (!response.ok || !payload.request) {
      throw new Error(payload.error?.message ?? "Approval link is invalid");
    }
    return payload.request;
  }, [token]);

  useEffect(() => {
    let active = true;
    void detectPasskeyReadiness().then((readiness) => {
      if (active) setPasskeyReadiness(readiness);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadRequest()
      .then((nextRequest) => {
        if (active) {
          updateRequest(nextRequest);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : "Approval load failed",
          );
        }
      })
      .finally(() => {
        if (active) {
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [loadRequest, updateRequest]);

  function markPravaApprovalOpened() {
    if (!request?.prava) {
      return;
    }
    localStorage.setItem(pravaApprovalStorageKey(request)!, "true");
    setPravaApprovalOpened(true);
  }

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/live/approve/${token}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        request?: LiveRequestSnapshot;
      };
      if (!response.ok || !payload.request) {
        throw new Error(payload.error?.message ?? "Approval failed");
      }
      updateRequest(payload.request);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function rejectApproval() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/live/approve/${token}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        request?: LiveRequestSnapshot;
      };
      if (!response.ok || !payload.request) {
        throw new Error(payload.error?.message ?? "Rejection failed");
      }
      updateRequest(payload.request);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rejection failed");
    } finally {
      setBusy(false);
    }
  }

  async function createPravaSession() {
    if (!request) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/live/requests/${request.id}/prava/session`,
        {
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
        request?: LiveRequestSnapshot;
      };
      if (!response.ok || !payload.request) {
        throw new Error(
          payload.error?.message ?? "Prava session creation failed",
        );
      }
      updateRequest(payload.request);
    } catch (caught) {
      const refreshedRequest = await loadRequest().catch(() => null);
      if (refreshedRequest) {
        updateRequest(refreshedRequest);
      }
      setError(
        caught instanceof Error ? caught.message : "Prava session failed",
      );
    } finally {
      setBusy(false);
    }
  }

  const reconcilePrava = useCallback(async () => {
    if (!request) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/live/requests/${request.id}/prava/reconcile`,
        {
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
        request?: LiveRequestSnapshot;
      };
      if (!response.ok || !payload.request) {
        throw new Error(
          payload.error?.message ?? "Prava reconciliation failed",
        );
      }
      updateRequest(payload.request);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Prava reconciliation failed",
      );
    } finally {
      setBusy(false);
    }
  }, [request, updateRequest]);

  async function revokePrava() {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/live/requests/${request.id}/prava/revoke`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
        request?: LiveRequestSnapshot;
      };
      if (!response.ok || !payload.request) {
        throw new Error(payload.error?.message ?? "Prava revocation failed");
      }
      updateRequest(payload.request);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Prava revocation failed",
      );
    } finally {
      setBusy(false);
    }
  }

  const executeMerchantCheckout = useCallback(async () => {
    if (!request) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/live/requests/${request.id}/merchant/execute`,
        {
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
        request?: LiveRequestSnapshot;
      };
      if (!response.ok || !payload.request) {
        throw new Error(
          payload.error?.message ?? "Merchant execution failed closed",
        );
      }
      updateRequest(payload.request);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Merchant execution failed closed",
      );
    } finally {
      setBusy(false);
    }
  }, [request, updateRequest]);

  useEffect(() => {
    if (!request || busy || !pravaApprovalOpened) return;

    if (
      request.state === "prava_pending" &&
      automaticPollAttempts.current < 60
    ) {
      const timeout = window.setTimeout(() => {
        automaticPollAttempts.current += 1;
        void reconcilePrava();
      }, 3_000);
      return () => window.clearTimeout(timeout);
    }

    if (
      request.state === "credentials_issued" &&
      !automaticExecutionStarted.current
    ) {
      automaticExecutionStarted.current = true;
      void executeMerchantCheckout();
    }
  }, [
    busy,
    executeMerchantCheckout,
    pravaApprovalOpened,
    reconcilePrava,
    request,
  ]);

  const artifact = request?.approval?.artifact;
  const sessionCreationBlock = request
    ? getPravaSessionCreationBlock(request)
    : null;
  const controlledReceipt = request
    ? getControlledSandboxReceipt(request)
    : null;
  const sessionOutcomeUnknown = Boolean(
    request?.state === "prava_session_unknown" ||
    request?.pravaSessionOperation?.status === "unknown",
  );

  return (
    <main className={styles.approvalPage}>
      <section className={styles.approvalPanel}>
        <p className={styles.eyebrow}>APPROVAL LINK / SINGLE USE</p>
        <h1>
          {sessionOutcomeUnknown
            ? "Prava session outcome unknown."
            : request?.state === "approved"
              ? "Artifact approved."
              : "Approve the exact artifact."}
        </h1>
        <p className={styles.lede}>
          This decision binds merchant, SKU, variant, quantity, total, evidence,
          and expiry. The approval-link holder accepts this artifact; the link
          does not independently verify manager identity.
        </p>

        {busy && !request ? <p>Loading durable request...</p> : null}
        {error ? <p className={styles.errorBanner}>{error}</p> : null}

        {artifact ? (
          <div className={styles.artifact}>
            <div>
              <span>Product</span>
              <strong>{artifact.productName}</strong>
            </div>
            <div>
              <span>Merchant</span>
              <strong>{artifact.merchantName}</strong>
            </div>
            <div>
              <span>Exact variant</span>
              <strong>
                {artifact.quotedColor} / {artifact.quotedSize}
              </strong>
            </div>
            <div>
              <span>SKU</span>
              <strong>{artifact.sku}</strong>
            </div>
            <div>
              <span>Quantity</span>
              <strong>{artifact.quantity}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>
                {new Intl.NumberFormat("en-US", {
                  currency: artifact.currency,
                  style: "currency",
                }).format(artifact.quoteTotalMinor / 100)}
              </strong>
            </div>
            <div className={styles.hashRow}>
              <span>Artifact hash</span>
              <code>{request.approval?.artifactHash}</code>
            </div>
          </div>
        ) : null}

        {request?.state === "approval_pending" ? (
          <div>
            <button
              className={styles.primaryButton}
              disabled={busy}
              onClick={approve}
              type="button"
            >
              {busy ? "Approving..." : "Approve exact artifact"}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={busy}
              onClick={rejectApproval}
              type="button"
            >
              Reject purchase
            </button>
          </div>
        ) : null}

        {request &&
        ["approved", "prava_session_unknown"].includes(request.state) ? (
          <div className={styles.successBanner}>
            {sessionOutcomeUnknown
              ? "Approval recorded. Payment execution is paused pending operator reconciliation."
              : "Approval recorded. The exact artifact is now eligible for a Prava sandbox session."}
          </div>
        ) : null}

        {request &&
        ["approved", "prava_session_unknown"].includes(request.state) &&
        !request.prava ? (
          <div className={styles.paymentAvailability}>
            <strong>
              {sessionCreationBlock
                ? sessionCreationBlock.heading
                : paymentAvailability.enabled
                  ? "Sandbox payment ready"
                  : "Prava session: not created"}
            </strong>
            <p>
              {sessionCreationBlock?.message ?? paymentAvailability.message}
            </p>
            {sessionOutcomeUnknown && request.pravaSessionOperation ? (
              <div className={styles.artifact}>
                <div>
                  <span>Workflow state</span>
                  <strong>Locked for reconciliation</strong>
                </div>
                <div>
                  <span>HTTP status</span>
                  <strong>
                    {request.pravaSessionOperation.httpStatus ?? "Not received"}
                  </strong>
                </div>
                <div>
                  <span>Vendor code</span>
                  <strong>
                    {request.pravaSessionOperation.vendorCode ?? "Not received"}
                  </strong>
                </div>
                <div>
                  <span>Response ID</span>
                  <strong>
                    {request.pravaSessionOperation.hasResponseId
                      ? "Recorded privately"
                      : "Not received"}
                  </strong>
                </div>
                <div>
                  <span>Merchant order</span>
                  <strong>Not claimed</strong>
                </div>
                <div>
                  <span>Live funds</span>
                  <strong>None moved</strong>
                </div>
              </div>
            ) : null}
            {!sessionCreationBlock && paymentAvailability.enabled ? (
              <button
                className={styles.primaryButton}
                disabled={busy}
                onClick={createPravaSession}
                type="button"
              >
                {busy
                  ? "Creating session..."
                  : "Create one Prava sandbox session"}
              </button>
            ) : !sessionCreationBlock ? (
              <p className={styles.safetyCopy}>
                No session request will be sent to Prava from this runtime.
              </p>
            ) : (
              <p className={styles.safetyCopy}>
                Retry is disabled for this approved artifact.
              </p>
            )}
          </div>
        ) : null}

        {request?.prava ? (
          <div className={styles.artifact}>
            <div>
              <span>Prava status</span>
              <strong>{request.prava.status}</strong>
            </div>
            <div>
              <span>Credential handling</span>
              <strong>
                {request.prava.credentialsReady
                  ? "Ready in Prava; never persisted"
                  : "Not issued"}
              </strong>
            </div>
            {pravaApprovalOpened ? (
              <p className={styles.safetyCopy}>
                The single-use approval link was opened once. Continue in the
                Prava tab without refreshing it. RelayBuy now polls
                automatically and will execute, report, and reconcile the exact
                approved sandbox attempt when credentials are ready.
              </p>
            ) : passkeyReadiness === "ready" ? (
              <a
                className={styles.approvalLink}
                href={request.prava.approvalUrl}
                onClick={markPravaApprovalOpened}
                rel="noreferrer"
                target="_blank"
              >
                Open Prava hosted approval
              </a>
            ) : passkeyReadiness === "checking" ? (
              <p className={styles.safetyCopy}>
                Checking this browser for a platform passkey authenticator…
              </p>
            ) : (
              <p className={styles.errorBanner}>
                This browser cannot complete Prava passkey approval. Open this
                approval page in Safari or Chrome on a device with Face ID,
                Touch ID, Android biometrics, or Windows Hello.
              </p>
            )}
            {!pravaApprovalOpened ? (
              <p className={styles.safetyCopy}>
                Use a normal browser window and allow third-party cookies and
                storage for Prava. Privacy extensions or embedded webviews can
                prevent card-network verification from starting.
              </p>
            ) : null}
            <button
              className={styles.primaryButton}
              disabled={busy || !canReconcilePrava(request)}
              onClick={reconcilePrava}
              type="button"
            >
              {busy ? "Checking..." : "Check Prava status now"}
            </button>
            {["prava_pending", "credentials_issued"].includes(request.state) ? (
              <button
                className={styles.secondaryButton}
                disabled={busy}
                onClick={revokePrava}
                type="button"
              >
                {busy ? "Revoking..." : "Cancel and revoke Prava session"}
              </button>
            ) : null}
            {request.state === "credentials_issued" ? (
              <>
                <p className={styles.safetyCopy}>
                  This submits the one-time sandbox credential to the real,
                  allowlisted Bones Coffee checkout. It expects a merchant
                  decline, creates no order, and reports only the observed
                  outcome.
                </p>
                <button
                  className={styles.primaryButton}
                  disabled={busy}
                  onClick={executeMerchantCheckout}
                  type="button"
                >
                  {busy
                    ? "Executing constrained checkout..."
                    : "Attempt merchant checkout and report"}
                </button>
              </>
            ) : null}
            {canReconcileOutcomeReport(request) ? (
              <>
                <p className={styles.safetyCopy}>
                  The merchant decline is already persisted. This reconciles the
                  interrupted report by polling Prava. It never resends the
                  report or runs checkout again.
                </p>
                <button
                  className={styles.primaryButton}
                  disabled={busy}
                  onClick={executeMerchantCheckout}
                  type="button"
                >
                  {busy ? "Reconciling report..." : "Reconcile outcome report"}
                </button>
              </>
            ) : null}
            {request.prava.merchantAttempt ? (
              <>
                <div>
                  <span>Merchant outcome</span>
                  <strong>
                    Declined after submission (
                    {request.prava.merchantAttempt.declineCode})
                  </strong>
                </div>
                <div>
                  <span>Merchant order</span>
                  <strong>No order created</strong>
                </div>
              </>
            ) : null}
            {request.prava.report ? (
              <>
                <div>
                  <span>Prava report</span>
                  <strong>{request.prava.report.txnStatus} acknowledged</strong>
                </div>
                <div>
                  <span>Live funds</span>
                  <strong>None moved (sandbox)</strong>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {controlledReceipt ? (
          <section
            aria-label="Controlled sandbox result"
            className={styles.receiptCard}
          >
            <p className={styles.cardOwner}>CONTROLLED SANDBOX RESULT</p>
            <h2>{controlledReceipt.controlStatus}</h2>
            <dl>
              <div>
                <dt>Approved artifact</dt>
                <dd>{controlledReceipt.artifact}</dd>
              </div>
              <div>
                <dt>Prava lifecycle</dt>
                <dd>{controlledReceipt.pravaLifecycle}</dd>
              </div>
              <div>
                <dt>Merchant attempt</dt>
                <dd>{controlledReceipt.merchantAttempt}</dd>
              </div>
              <div>
                <dt>Merchant outcome</dt>
                <dd>{controlledReceipt.merchantOutcome}</dd>
              </div>
              <div>
                <dt>Outcome reported</dt>
                <dd>{controlledReceipt.outcomeReport}</dd>
              </div>
              <div>
                <dt>Merchant order</dt>
                <dd>{controlledReceipt.merchantOrder}</dd>
              </div>
              <div>
                <dt>Live funds</dt>
                <dd>{controlledReceipt.liveFunds}</dd>
              </div>
            </dl>
            <p className={styles.safetyCopy}>
              “Complete” describes the sandbox control workflow, not a
              successful payment or merchant order.
            </p>
          </section>
        ) : null}

        <Link className={styles.backLink} href="/live">
          Return to live control plane
        </Link>
      </section>
    </main>
  );
}
