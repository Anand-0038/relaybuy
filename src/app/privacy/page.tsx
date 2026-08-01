import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How RelayBuy handles request, approval, and payment data.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-main" id="main">
      <p className="eyebrow">RelayBuy policy</p>
      <h1>Privacy and data handling</h1>
      <p className="legal-lead">
        RelayBuy minimizes the data it handles and confines ephemeral payment
        credentials to isolated server memory during checkout.
      </p>

      <section>
        <h2>Data RelayBuy processes</h2>
        <p>
          A request may include message text, a product photo, a voice
          transcript, requested options, quantity, location policy, quote
          evidence, and approval status. Raw media should be retained only as
          long as needed to resolve the request.
        </p>
      </section>

      <section>
        <h2>Payment data</h2>
        <p>
          Prava collects and authorizes payment details. RelayBuy never
          persists, logs, traces, or returns card numbers, CVV values, passkey
          material, network tokens, or unredacted payment credentials. Ephemeral
          checkout credentials are discarded immediately after the constrained
          merchant attempt.
        </p>
      </section>

      <section>
        <h2>AI processing</h2>
        <p>
          When live extraction is enabled, request text, approved image URLs,
          and voice transcripts may be sent to OpenAI solely to extract product
          identifiers and constraints. Deterministic code, not the model,
          decides compatibility, budget, approval validity, and payment access.
        </p>
      </section>

      <section>
        <h2>Live sandbox workflow</h2>
        <p>
          The canonical experience uses real OpenAI and Senso calls, a durable
          PostgreSQL request record, explicit manager approval, and Prava&apos;s
          sandbox authorization flow. Sandbox activity moves no live funds and
          is reported separately from the observed merchant outcome.
        </p>
      </section>

      <p className="legal-updated">Updated 29 July 2026.</p>
    </main>
  );
}
