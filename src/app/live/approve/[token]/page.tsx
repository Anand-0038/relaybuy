import type { Metadata } from "next";

import { ApprovalClient } from "@/components/live/approval-client";
import { getSandboxPaymentAvailability } from "@/live/payment-readiness";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Manager approval",
};

export default async function LiveApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <ApprovalClient
      paymentAvailability={getSandboxPaymentAvailability(process.env)}
      token={token}
    />
  );
}
