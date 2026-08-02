# Prava sandbox runbook

**Provider guidance captured:** 2026-08-02 UTC

Use this checklist before consuming a sandbox transaction or opening a Prava
support thread. It records operational guidance announced by the Prava team;
Prava's current documentation and playground remain authoritative for the
request contract.

## Before creating a session

1. Compare the complete request body with Prava's Create Session playground.
   Do not infer fields or reuse an older payload shape.
2. Use a real, deliverable email address on a conventional public domain such
   as Gmail. Do not use `.local`, `.warrant`, random, or disposable-looking
   domains.
3. Send a valid public merchant URL with an `https://` scheme.
4. Run `npm run sandbox:check` and confirm that the exact environment is armed.
5. Create only one session for one newly approved RelayBuy artifact.

Never put API keys, full card data, OTPs, passkey material, approval URLs,
session references, or private external order references in source control,
screenshots, public Discord messages, or submission evidence.

## Hosted approval checks

- Use the exact sandbox card supplied to the team unless Prava support directs
  otherwise.
- Use a device and browser with working passkey support: Face ID, Touch ID, or
  Windows Hello.
- On Windows, enable and verify Windows Hello before testing.
- If desktop passkey enrollment fails, open the one-time iframe URL once on a
  trusted mobile device with Face ID or Touch ID. Do not refresh or reopen a
  single-use link.

## Failure handling

- A known validation rejection may be corrected only when RelayBuy records the
  operation as `failed`.
- A timeout, transport failure, HTTP 5xx, malformed success payload, or other
  ambiguous result is `unknown`. Do not retry it, delete its operation row, or
  reuse its approval artifact.
- Prava's 2026-08-02 abnormal-traffic announcement is useful incident context,
  but does not prove whether a specific session POST was accepted.
- Inspect a redacted operation with:

  ```bash
  npm run inspect:prava-session -- RB-XXXXXXXX
  ```

  Reveal the private external reference only in a private Prava support bundle
  and only when support requests it.

## Support thread checklist

Open a thread in Prava's support channel only after completing the checks
above. Include privately, as applicable:

- session ID, if one was returned;
- order ID, if one is visible;
- RelayBuy public request ID;
- operation timestamp, safe HTTP status, vendor code, and whether a response ID
  was received;
- operating system, browser, device, and passkey capability;
- the exact stage that failed.

Do not claim that a merchant order or payment succeeded unless the connected
lifecycle and provider dashboard independently prove it.
