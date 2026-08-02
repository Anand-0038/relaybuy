"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LiveRequestSnapshot } from "@/live/types";

import styles from "./live-console.module.css";

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

export function ApprovalClient({ token }: { token: string }) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    let active = true;
    fetch(`/api/live/approve/${token}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          error?: { message?: string };
          request?: LiveRequestSnapshot;
        };
        if (!response.ok || !payload.request) {
          throw new Error(payload.error?.message ?? "Approval link is invalid");
        }
        if (active) {
          updateRequest(payload.request);
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
  }, [token, updateRequest]);

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

  return (
    <main className={styles.approvalPage}>
      <section className={styles.approvalPanel}>
        <p className={styles.eyebrow}>APPROVAL LINK / SINGLE USE</p>
        <h1>
          {request?.state === "approved"
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

        {request?.state === "approved" ? (
          <div className={styles.successBanner}>
            Approval recorded. The exact artifact is now eligible for a Prava
            sandbox session.
          </div>
        ) : null}

        {request?.state === "approved" && !request.prava ? (
          <button
            className={styles.primaryButton}
            disabled={busy}
            onClick={createPravaSession}
            type="button"
          >
            {busy ? "Creating session..." : "Create Prava sandbox session"}
          </button>
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
            ) : (
              <a
                className={styles.approvalLink}
                href={request.prava.approvalUrl}
                onClick={markPravaApprovalOpened}
                rel="noreferrer"
                target="_blank"
              >
                Open Prava hosted approval
              </a>
            )}
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

        <Link className={styles.backLink} href="/live">
          Return to live control plane
        </Link>
      </section>
    </main>
  );
}
