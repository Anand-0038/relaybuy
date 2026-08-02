# RelayBuy Discord showcase

Hey everyone! We are building **RelayBuy — proof before purchase for AI
agents.**

Most commerce agents focus on completing checkout quickly. RelayBuy focuses on
proving that the exact purchase is authorized before payment credentials can be
issued.

## What it does

A user can write:

> Buy the approved $10 gift card, but never spend more than $12.

RelayBuy then:

1. Uses the OpenAI Agents SDK to extract typed intent, with no payment or
   approval authority.
2. Independently retrieves the current merchant variant, SKU, and total.
3. Retrieves the exact version-and-digest-bound policy record from Senso.
4. Deterministically verifies variant, budget, quote freshness, and payload.
5. Requests single-use human approval bound to that exact purchase.
6. Allows only the approved payload to enter Prava's sandbox authorization and
   reconciliation flow.

The memorable part of our demo is refusal first: choose the wrong denomination
or exceed the budget and RelayBuy stops before payment with:

**Prava session: not created.**

## Why we built it

Agents should not be able to turn "looks right" into authorized spending.
RelayBuy separates intent, independent evidence, deterministic policy, human
approval, and payment so an LLM can assist without becoming the
decision-maker.

## Current progress

- Real OpenAI typed-intent extraction
- Exact Senso policy evidence with citations and version/digest binding
- Live merchant variant discovery
- Deterministic refusal, approval, and payment gates
- Single-use payload-bound approval
- PostgreSQL durability and unknown-outcome reconciliation
- Integrated Prava sandbox session, polling, revocation, outcome reporting,
  and terminal-state handling
- Final hosted authorization proof and demo recording in progress

GitHub: https://github.com/Anand-0038/relaybuy

We would especially value feedback on whether the refusal-first demo makes the
trust boundary immediately understandable.
