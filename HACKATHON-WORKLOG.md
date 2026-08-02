# RelayBuy hackathon work log

This log records genuine implementation work after the public launch snapshot.
It does not reconstruct or fabricate earlier commit history.

## 2026-08-01 security and product hardening

- Restricted production mutations to the configured application origin and
  hostname, with hostile host and forwarded-host regression tests.
- Replaced the approval URL token after consumption with a separate short-lived
  execution capability delivered only through an HttpOnly, SameSite=Strict
  cookie.
- Added durable known-failure and unknown-outcome states for Prava reporting.
- Added optimistic version checks to prevent stale provider snapshots from
  overwriting newer state.
- Preserved successful Prava response IDs and safe timing/status metadata.
- Added active Prava session revocation and explicit purchase rejection.
- Added one durable clarification turn that automatically resumes extraction,
  evidence retrieval, and deterministic policy evaluation.
- Added live discovery of all current Bones Coffee gift-card variants while
  keeping execution pinned to the independently authorized SKU.
- Added bounded automatic polling, merchant execution, outcome reporting, and
  terminal reconciliation after hosted Prava authorization.
- Changed evidence persistence to use internal row IDs plus request-scoped
  external citation uniqueness.
- Revalidated Shopify payment frame URLs immediately before credential
  submission.

## 2026-08-02 connected proof and release preparation

- Published a concise build disclosure plus current architecture, security,
  and known-limitations documents without exposing private runbooks or
  authorization evidence.
- Added a gated connected browser proof for the wrong-denomination refusal.
  It exercises real OpenAI, merchant, Senso, and PostgreSQL boundaries while
  payment remains disabled.
- Fixed the Playwright server origin so connected mutation tests use the same
  configured origin as the browser.
- Recorded the refusal screen locally with `COLOR_MISMATCH`, four discovered
  merchant variants, no approval link, and `Prava session: not created`.
- Refreshed and reverified the exact Senso content/version/digest binding; the
  full connected provider preflight passed before the refusal recording.

## Honest external boundary

The source and local connected pre-payment path can be verified without moving
funds. A complete Prava sandbox lifecycle still requires Anand to perform the
hosted card, OTP, and passkey steps on a WebAuthn-capable device. No completed
merchant order is claimed.
