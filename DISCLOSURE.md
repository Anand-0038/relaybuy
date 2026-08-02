# RelayBuy build disclosure

RelayBuy was developed for the 2026 Prava Agentic Commerce Hackathon. This
document separates the starting point from the work added during the event so
judges can evaluate the submission accurately.

## Starting point

The repository tag `pre-event-boundary` points to commit
`34b339fbafe910c418b53c92429717989780ce79` from 2026-07-26. That snapshot
contained a Next.js scaffold, pure deterministic purchasing rules, fixture-only
adapters, and rehearsal UI. It did not contain a real Prava network adapter, a
connected OpenAI agent, a production deployment, or a completed transaction.

Before the event opened, additional uncommitted rehearsal work existed for the
connected architecture, Prava sandbox exploration, Senso setup, and deployment
planning. The first public commit, `2d6056077dbba6b975c07860b85dfdc815946a35`
on 2026-08-01, consolidated that baseline. RelayBuy does not present every line
of that commit as event-window work.

## Event-window work

The post-launch event work is recorded in `HACKATHON-WORKLOG.md` and includes:

- durable clarification and automatic resumption of incomplete requests;
- live merchant variant discovery with execution eligibility kept separate;
- replacement of consumed approval URLs with short-lived HttpOnly execution
  capabilities;
- explicit approval rejection and unused-session revocation;
- optimistic state-version checks and durable unknown/rejected provider
  outcomes;
- safe Prava response metadata for reconciliation;
- bounded automatic polling through merchant execution, outcome reporting, and
  terminal reconciliation;
- expanded contract, authorization, and lifecycle regression coverage; and
- the public architecture, security, limitations, and submission documents.

## Claims boundary

The application uses real OpenAI, merchant, Senso, PostgreSQL, and Prava
sandbox integrations. Fixtures and fabricated provider success are not used in
the connected judge path.

Prava sandbox authorization proves controlled payment mechanics only. It does
not prove live funds movement or a merchant order. RelayBuy describes a
merchant order only when a merchant returns an authoritative order result;
`pending`, `awaiting_result`, and a Prava-internal order identifier do not meet
that boundary.

No API key, approval URL, session identifier, card data, network token,
dynamic CVV, passkey material, address, email, or other private authorization
data belongs in the repository or submission media.
