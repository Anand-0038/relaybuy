# RelayBuy security model

RelayBuy treats model output, merchant content, retrieved text, and provider
responses as untrusted inputs. The model never receives authority to approve
or execute a payment.

## Primary controls

- Typed OpenAI output is limited to user intent.
- Merchant facts are fetched independently and validated at the boundary.
- Senso authorization requires exact content, version, and digest bindings.
- Pure TypeScript owns variant, budget, freshness, approval, and payment gates.
- Offer and evidence freshness are checked at evaluation, approval
  consumption, and session creation.
- Owner, approval, and execution capabilities are random, scoped, expiring,
  and stored only as HMACs where persistence is required.
- Approval tokens are single-use and replaced by an HttpOnly execution cookie.
- Mutations enforce trusted origin and host, bounded bodies, capability-scoped
  rate limits, and private no-store responses.
- Prava session creation and outcome reporting are durably claimed before the
  external call. Ambiguous outcomes stop for reconciliation.
- Merchant navigation is pinned to the approved HTTPS origin. Credential entry
  is restricted to Shopify's approved PCI iframe origin.

## Sensitive-data boundary

The following must never be rendered, logged, persisted, committed, included
in screenshots, or sent through the model:

- API keys and authorization URLs;
- raw Prava session identifiers and session tokens;
- PAN, CVV, dynamic CVV, network token, cryptogram, or passkey assertion;
- full address, email, phone number, or billing profile; and
- unredacted provider payloads.

RelayBuy retains only redacted opaque references, state, reason codes, safe
HTTP metadata, and hashes needed to prove binding and recovery behavior.

## Deliberate non-claims

Possession of an approval link is a scoped capability, not proof of a person's
organizational identity. The hackathon application is a single-user control
plane, not production account authentication, tenant isolation, or distributed
rate limiting. See `KNOWN-LIMITATIONS.md` for the remaining production work.

Security issues can be reported through `/.well-known/security.txt`.
