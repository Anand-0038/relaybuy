# RelayBuy

RelayBuy is a proof-carrying purchase approval system for AI agents. It binds
an exact merchant, item, amount, structured evidence record, and approval-link
decision before Prava issues payment credentials, then reconciles what
actually happened at the merchant.

Public design and submission context:

- [Build disclosure](DISCLOSURE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [Known limitations](docs/KNOWN-LIMITATIONS.md)

The canonical demo proves the unsafe cases first:

```text
messy request
→ one precise clarification
→ live variant discovery
→ wrong variant refused
→ over-budget quote refused
→ exact approval payload
→ one controlled Prava sandbox authorization
→ reconciled terminal mechanics result
```

The connected sandbox path is intentionally narrow: text request, independently
verified merchant offer, structured Senso policy evidence, deterministic
policy, capability-link approval, Prava authorization, and a constrained
merchant-decline experiment. It does not claim a completed order.

## Run locally

Requirements:

- Node.js 20.9 or newer
- npm
- Playwright Chromium for browser tests

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The root redirects to the
connected `/live` control plane. Provider configuration is required for that
path; missing or unavailable providers fail closed and never fall back to
fixtures.

## Planned deployment target

The production deployment target for RelayBuy is:

- `https://relaybuy.a2zbtc.com`

You own `a2zbtc.com`, so DNS and TLS handoff will point to this relay buy
instance once the final event gate is complete.

The repository now includes a schema-validated [`render.yaml`](render.yaml)
for a manually deployed Singapore web service using the existing Render
Postgres database. It binds Next.js to `0.0.0.0:$PORT`, checks `/api/health`,
keeps every payment capability disabled, and leaves provider secrets outside
Git. Render service creation is not complete, and `relaybuy.a2zbtc.com` does not
yet resolve.

Keep the default-safe payment flags in `.env.local` exactly as follows:

```text
PRAVA_MODE=replay
PAYMENTS_ENABLED=false
ALLOW_PRAVA_SESSION_CREATION=false
ALLOW_PRAVA_LIVE_ORDER=false
PRAVA_MCP_CONTRACT_CONFIRMED=false
# PRAVA_MCP_CONTRACT_CONFIRMATION=
```

The connected text path requires a server-only `OPENAI_API_KEY`,
`OPENAI_MODEL`, and `OPENAI_FALLBACK_MODEL`. A separate optional photo and
transcript extractor is exposed at `POST /api/extract` only when
`OPENAI_EXTRACTION_ENABLED=true`; it accepts same-origin bounded input and has
no payment tools.

## Validate

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run rehearse
npm run preflight
npm run test:e2e:connected-refusal
```

`npm run rehearse` runs the canonical browser suite five consecutive times with
one worker.

The connected refusal command performs real OpenAI, merchant, Senso, and
PostgreSQL calls, but keeps payment disabled and asserts that no approval link
or Prava session exists for the wrong denomination. It saves its redacted
screenshot only in the ignored parent `artifacts/` directory.

## Trust boundaries

- The OpenAI Agents SDK is used by one typed extraction agent. It has no tools
  or handoffs and cannot decide option matches, budgets, workflow state, or
  payment.
- Pure TypeScript functions own option normalization, `VariantDecision`,
  `BudgetDecision`, `PaymentGate`, and state transitions.
- The pure payment gate rejects session creation while `PRAVA_MODE=replay` or
  any payment capability flag is disabled. The retired replay UI and APIs are
  not shipped.
- Sandbox mode is pinned to `https://sandbox.api.prava.space` and accepts only
  `sk_test_*`. It proves payment mechanics only and can never emit a merchant
  order.
- The current sandbox flow uses Prava REST session creation and the hosted
  approval URL. `@prava-sdk/core` is intentionally deferred unless RelayBuy
  adopts embedded card collection.
- Live-order mode remains fail-closed until Prava confirms the authoritative MCP
  execution contract in writing and a same-turn human approves the exact order.
- Credential-bearing Prava responses are reduced to safe status objects inside
  the server-side adapter. Session tokens, card tokens, CVV data, passkey
  material, and full addresses are never returned, logged, rendered, or
  persisted.
- Sandbox session references are authenticated and encrypted. They survive a
  local process restart without persisting the underlying Prava session ID.
- Vendor requests have explicit timeouts. Ambiguous timeouts fail closed, while
  safe HTTP status, vendor code, and `X-Response-ID` diagnostics are retained.
- Every connected request is bound to a random owner capability stored only as
  an HMAC. Pre-approval routes require that capability; payment and merchant
  routes require a separate short-lived execution capability minted only when
  approval is consumed and delivered through an HttpOnly, SameSite=Strict
  cookie. The URL approval token is revoked atomically. Mutation routes enforce
  same-origin requests, bounded bodies, capability-scoped rate limits, and
  private no-store responses.
- The connected extractor emits user intent only. Merchant URL, SKU, quoted
  variant, price, fees, and total come from a live merchant product adapter.
- Senso policy authority requires an exact content ID, version ID, and
  structured-record SHA-256 binding containing a `RELAYBUY_POLICY_RECORD`;
  generated answers, mutable content IDs, and substring matches cannot
  authorize a purchase.
- Session and outcome-report operations are claimed durably in PostgreSQL
  before external calls. Unknown session-creation outcomes stop for
  reconciliation. A lost outcome-report acknowledgement also stops and is
  reconciled by polling; RelayBuy never resends the report blindly.
- Successful Prava calls retain safe response ID, status, and timing metadata;
  explicit report rejection and unknown acknowledgement have separate durable
  recovery states.
- Active, unused Prava sessions can be revoked from RelayBuy. Revocation and
  rejection are first-class terminal controls.

## What is already done (as of August 2026)

- The connected request, evidence, deterministic policy, capability approval,
  Prava session, reconciliation, and merchant-attempt boundaries are complete.
- Retired replay UI, APIs, JSON persistence, and the unused payment-agent tool
  were removed from the shipped application.
- Incomplete intent now enters a durable clarification state, asks one bounded
  question, and automatically resumes extraction, evidence, and policy after
  the answer.
- The merchant adapter discovers every currently available gift-card variant
  from the live product feed and displays why only the Senso-bound `$10` SKU is
  execution-eligible.
- OpenAI extraction is wired into the connected path with bounded retries and
  typed fail-closed provider errors. Participant credits became usable and the
  real typed extraction passed the 2026-08-01 connected preflight.
- The Senso API key authenticates and both exact searches recovered the same
  freshly synchronized immutable policy record. Because the record is
  deliberately short-lived, rerun the hardened evidence sync immediately
  before the demo.
- The integrated `/live` flow owns sandbox session creation, hosted approval,
  payment-result polling, constrained merchant execution, outcome reporting,
  and terminal reconciliation. The latest historical session expired in
  `pending` because card/passkey approval was not completed.
- After the hosted Prava page is opened, RelayBuy performs bounded automatic
  polling and resumes checkout, reporting, and terminal reconciliation without
  requiring the user to click every internal state transition.
- The project `.env.local` is prepared for default-safe operation; connected
  tooling rejects conflicting ambient credentials.
- The root and judge-facing browser path are aligned on `/live`; transaction
  proof remains gate-dependent.
- Private operator notes, evidence, and vendor snapshots are kept outside the
  public code repository.
- Canonical metadata, social cards, sitemap, robots policy, privacy page,
  security contact route, CSP, HSTS, and private-route cache/indexing policy are
  implemented for the planned public host.
- The Render deployment Blueprint and disclosure-aware pull-request checklist
  are present and regression-tested. No web service or DNS record is claimed.

## UI and assets for production polish

RelayBuy includes brand assets for launch readiness:

- `public/favicon.ico`
- `public/favicon.svg`
- `public/favicon-16.png`
- `public/favicon-32.png`
- `public/apple-touch-icon.png`
- `public/apple-touch-icon.svg`
- `public/site.webmanifest`
- `public/safari-pinned-tab.svg`

These assets are wired from `src/app/layout.tsx` and should be reviewed before
DNS cutover to `relaybuy.a2zbtc.com`.

## Canonical connected demo

The recording contract is 110–120 seconds. The connected proof sequence is:

1. OpenAI extracts the requested gift-card denomination and budget only.
2. The live Bones Coffee adapter independently supplies merchant, SKU, option,
   and current `$10.00` total.
3. A `$25.00` request is deterministically refused against the `$10.00`
   candidate, with `Prava session: not created`.
4. Senso returns cited allowlisted policy evidence for the exact merchant and
   SKU.
5. The corrected `$10.00` artifact is displayed and accepted through a
   single-use hash-bound approval link.
6. Only after that approval may RelayBuy create one Prava sandbox session,
   complete hosted card/passkey approval, observe the real merchant decline,
   report `DECLINED`, and show the terminal mechanics-only result.

The sandbox sequence never claims payment success or a merchant order.

## Hackathon production qualification

The organizer guidance supplied on 2026-08-01 sets this minimum bar before a
production-access application:

1. Complete the Prava sandbox lifecycle end to end inside the application.
2. Use browser automation to submit a tokenized sandbox-card attempt against a
   real merchant. The expected merchant failure is accepted as working sandbox
   proof.
3. Show a meaningful Prava or partner-track integration, not a landing page or
   mockup.
4. Apply only after the redacted sandbox evidence packet is complete.

The temporary production-access application is
<https://tally.so/r/eq8NZE>. Submission is not approval, and any granted access
is limited to the hackathon judging period.

## Completion boundary

| Locally complete                                               | Requires external action                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Typed OpenAI text extraction with no payment tools             | Keep the credited OpenAI project selected for the demo                                   |
| Deterministic variant, budget, approval, and payment gates     | Fresh hosted test-card, OTP, and passkey approval through `awaiting_result`              |
| Restart-safe Prava sandbox session/status adapter              | One disclosed merchant attempt, outcome report, and terminal sandbox poll                |
| PostgreSQL live requests and durable external-operation claims | Backup/retention operations for a continued product                                      |
| Schema-validated, fail-closed Render Blueprint                 | Add a Git remote, create the web service, then complete DNS/TLS smoke testing            |
| Security, metadata, privacy, robots, sitemap, and social cards | Resolve and verify `relaybuy.a2zbtc.com`                                                 |
| Fail-closed live gateway boundary                              | Written support confirmation + confirmed MCP contract + one authorized merchant checkout |

RelayBuy will not replace the final column with fixtures or prose. Only an
official `shop_checkout` result may become a merchant order.

Run `npm run preflight` before every connected rehearsal. It safely verifies
OpenAI inference capacity, the immutable Senso policy binding, the Prava
sandbox key with a non-creating validation request, PostgreSQL, the exact
merchant offer, and safe payment flags without creating a payment session.
The equivalent `/api/ready` probe is operator-only, bearer-protected, and
rate-limited because it performs those real connected calls; `/api/health`
remains the public process-liveness endpoint.

Live mode remains blocked until written confirmation is recorded in
`PRAVA_MCP_CONTRACT_CONFIRMATION` and `PRAVA_MCP_CONTRACT_CONFIRMED=true`.
The payload must come from a written Prava Support/Birdie/team response in the
official support channel and include resolution for the known MCP ambiguities
(sequence authority, post-quote total change behavior, precedence policy,
contradiction resolution, and timeout recovery).
`src/config/runtime.ts` enforces this as `LIVE_MCP_CONTRACT_UNCONFIRMED`.

The controlled sandbox sequence runs only through `/live`. It uses the real
merchant adapter and treats the expected sandbox-card decline as payment-control
evidence, never as a merchant order.

## Project map

```text
src/domain/                 deterministic decisions and state machine
src/live/                   connected trust and lifecycle control plane
src/db/                     additive PostgreSQL schema
src/agent/                  extraction-only agent
src/integrations/prava/     sandbox/live adapter boundaries
src/app/                    Next.js routes and UI
tests/e2e/                  canonical browser proof
```
