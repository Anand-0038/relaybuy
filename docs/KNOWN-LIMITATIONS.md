# Known limitations

**Updated:** 2026-08-02 UTC

## External proof

- Prava sandbox uses real WebAuthn and requires the cardholder to complete the
  hosted card, OTP, and passkey steps on a supported device.
- A fresh terminal run must reach `awaiting_result`, perform exactly one
  disclosed merchant attempt, report its real outcome, and poll a terminal
  `completed` or `failed` state.
- Sandbox state proves payment-control mechanics. It does not prove live funds
  movement, a successful payment, or a merchant order.
- Live MCP shopping remains disabled until Prava confirms the authoritative
  execution contract and recovery behavior in writing.
- Senso evidence is deliberately short-lived and must be refreshed and
  reverified before a recorded demo.
- The configured Render target and custom domain are not considered deployed
  until an external clean-browser smoke test succeeds.
- Linq, Visa Intelligent Commerce, and NANDA Town are not implemented tracks.

## Product scope

- The connected judge path is text-only.
- The canonical proof item is a $10 digital gift card. It demonstrates exact
  denomination and spend control, not physical fulfillment.
- The merchant adapter is intentionally allowlisted rather than a universal
  shopping crawler.
- The controlled merchant attempt is expected to reject sandbox credentials;
  RelayBuy records and reports that observed decline instead of inventing an
  order.

## Production work

- Capability links are not user accounts or verified manager identity.
- The in-process rate limiter is not distributed across service replicas.
- Production authentication, tenant isolation, retention operations,
  observability, and incident response remain deployment work.
- Raw image/audio upload, transcription, EXIF removal, and malware scanning are
  outside the connected path.
- Unknown provider outcomes require reconciliation; RelayBuy intentionally
  offers no automatic blind retry.
