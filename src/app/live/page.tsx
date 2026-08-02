import type { Metadata } from "next";

import { LiveConsole } from "@/components/live/live-console";
import { getSandboxPaymentAvailability } from "@/live/payment-readiness";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description:
    "Run RelayBuy's connected intent, verified offer, structured evidence, deterministic policy, and artifact approval path.",
  robots: { follow: false, index: false },
  title: "Proof Before Purchase",
};

export default function LivePage() {
  return (
    <LiveConsole
      paymentAvailability={getSandboxPaymentAvailability(process.env)}
    />
  );
}
