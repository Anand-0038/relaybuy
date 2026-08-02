# RelayBuy architecture

## Connected flow

```text
plain-language request
-> typed OpenAI intent
-> independent live merchant offer
-> exact Senso policy evidence
-> deterministic variant, budget, and freshness gates
-> hash-bound single-use human approval
-> fresh offer and evidence revalidation
-> pure PaymentGate
-> durable Prava sandbox session
-> one constrained merchant attempt
-> durable outcome report and terminal reconciliation
```

OpenAI extracts intent only. It cannot supply merchant facts, approve policy,
change workflow state, or reach payment operations. Merchant, SKU, option,
price, fees, and total come from the merchant adapter.

Senso is the policy-evidence authority. Both exact searches must resolve the
same structured policy record and match the configured content ID, version ID,
and SHA-256 record digest. A generated answer or approximate text match cannot
authorize a purchase.

## Application layers

- `src/app`: Next.js pages, metadata, and private API routes.
- `src/components/live`: the connected request and approval interfaces.
- `src/agent`: typed extraction with no tools or handoffs.
- `src/domain`: pure money, option, approval, and PaymentGate rules.
- `src/live`: lifecycle orchestration, evidence, capabilities, and persistence.
- `src/integrations/prava`: sandbox REST and fail-closed live boundaries.
- `src/db`: additive PostgreSQL schema and durable operation claims.

## Capabilities

Request creation returns a random owner capability. PostgreSQL stores only its
HMAC. Every pre-approval read and mutation requires that capability.

Approval links are random, pepper-hashed, expiring, payload-bound, and
single-use. Consuming one atomically revokes the URL token and mints a separate
short-lived execution capability delivered in an HttpOnly, SameSite=Strict
cookie. Prava session, reconciliation, revocation, and merchant routes require
that execution capability. A request UUID alone grants no authority.

Same-origin and production-host checks supplement capabilities for mutations.
Rate limiting is keyed to validated capabilities rather than caller-controlled
forwarded headers.

## Persistence and recovery

PostgreSQL stores redacted request snapshots and append-only audit events.
Unique durable claims prevent duplicate Prava session creation and duplicate
outcome reporting across processes.

An explicit provider rejection and an unknown remote outcome are different
states. Timeout, malformed response, HTTP 5xx, or lost acknowledgement enters
reconciliation without a blind retry. Successful calls retain only safe
operation, timing, response ID, and HTTP status metadata.

## Runtime boundary

- `replay`: safe default; external payment action is rejected.
- `sandbox`: Prava test credentials and hosted authorization; no live funds.
- `live`: disabled until production access and the written MCP contract are
  confirmed and the exact purchase receives same-turn human approval.

`awaiting_result` means one-time credentials were issued. It is not a merchant
order. The sandbox proof is complete only after one disclosed merchant attempt,
a matching Prava outcome acknowledgement, and a terminal poll.
