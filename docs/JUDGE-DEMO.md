# RelayBuy two-minute judge demo

RelayBuy is easiest to evaluate as one contrast: the same agent-assisted
workflow refuses an unapproved option, then permits only an exact,
evidence-bound candidate to reach human and payment authorization.

## Before recording

1. Run `npm run preflight` with every payment flag disabled.
2. Refresh and verify the short-lived Senso policy binding.
3. Open `/live` in a clean browser and confirm the refusal scenario is selected.
4. Put your camera on screen for the opening problem statement and final pitch;
   the organizer explicitly asked builders to appear, not submit only a screen recording.
5. Keep private approval URLs, session references, checkout profile data, card
   data, OTPs, passkeys, and provider secrets outside the recording.
6. Enable sandbox payment flags only for the one human-controlled terminal run,
   restart the server, and run `npm run sandbox:check`. Do not rerun the
   payment-disabled preflight after arming.

## Recording script

### 0:00–0:15 — The problem

Say: “A commerce agent can understand a request without being authorized to
spend. RelayBuy requires proof before purchase.”

Point to the visible trust path: OpenAI understands; merchant and Senso prove;
code decides; a human approves; only then can Prava authorize.

### 0:15–0:50 — Refusal first

1. Keep **1. Refusal proof** selected.
2. Run the evidence path.
3. Show the live merchant candidates and Senso citations.
4. Show `DENOMINATION_MISMATCH`, the requested and authorized denominations,
   and **Prava session: not created**.

Say: “The model did not refuse this purchase. Deterministic TypeScript compared
the requested `$25` denomination with the exact Senso-bound `$10` SKU. No
approval capability or payment session exists.”

### 0:50–1:25 — Exact authorization

1. Select **2. Exact candidate**.
2. Run the same connected path.
3. Show the passing checks and the exact approval artifact.
4. Explain that accepting the artifact consumes its URL capability and creates
   a short-lived HttpOnly execution capability.

Say: “Changing the SKU, amount, evidence version, digest, quote, or expiry
invalidates this approval.”

### 1:25–2:00 — Controlled payment and reconciliation

Show one previously prepared, redacted terminal record or complete the hosted
Prava sandbox authorization live. The valid proof sequence is:

```text
approved artifact
-> Prava hosted card, OTP, and passkey ceremony
-> awaiting_result
-> exactly one allowlisted merchant attempt
-> observed merchant outcome reported to Prava
-> terminal completed or failed poll
```

Say: “This is sandbox payment-control evidence. It is not a successful payment
or a merchant order.”

If the hosted ceremony fails or expires, stop there and show the honest state.
Do not substitute a replay, retry blindly, or describe `pending` or
`awaiting_result` as completion.

## Evidence allowed in the submission

- Public request ID and workflow state.
- Deterministic reason codes and checks.
- Public merchant, SKU, option, and total.
- Senso content/version identifiers and SHA-256 digests.
- Redacted provider operation, HTTP status, response ID, and timestamps.
- Terminal sandbox status and reported `APPROVED` or `DECLINED` result.

Never include full approval URLs, owner or execution capabilities, Prava
session references, card or token data, dynamic CVV, OTP, passkey material,
checkout profile data, provider secrets, or database credentials.

## Stop conditions

Stop the demo rather than creating another session when the Senso record is
stale, preflight is not fully ready, the approved payload changes, a provider
outcome is unknown, the payment session is already consumed, or the operator
is not ready to complete WebAuthn immediately.
