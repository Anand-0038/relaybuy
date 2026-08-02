import { z } from "zod";

export const liveRequestStateSchema = z.enum([
  "draft",
  "clarification_required",
  "extracted",
  "evidence_resolved",
  "refused",
  "approval_pending",
  "approved",
  "prava_session_unknown",
  "prava_pending",
  "credentials_issued",
  "merchant_checkout_running",
  "merchant_declined_test_card",
  "reporting_outcome",
  "report_failed",
  "report_unknown",
  "canceled",
  "prava_terminal_observed",
  "credential_window_lost",
  "merchant_blocked",
  "approval_invalidated",
  "reported",
  "rejected",
  "expired",
  "failed",
]);

export type LiveRequestState = z.infer<typeof liveRequestStateSchema>;

const nullableText = z.string().trim().min(1).nullable();
const nullableMoney = z.number().int().nonnegative().nullable();

export const purchaseIntentSchema = z
  .object({
    approvedMerchantOnly: z.boolean(),
    budgetMinor: nullableMoney,
    confidence: z.number().min(0).max(1),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    missingFields: z.array(z.string().trim().min(1)),
    neededBy: nullableText,
    preferredMerchant: nullableText,
    quantity: z.number().int().min(1).max(100),
    requestedColor: nullableText,
    requestedProduct: nullableText,
    requestedSize: nullableText,
  })
  .strict();

export type PurchaseIntent = z.infer<typeof purchaseIntentSchema>;

export const liveClarificationSchema = z
  .object({
    answer: z.string().trim().min(1).max(500).nullable(),
    answeredAt: z.iso.datetime().nullable(),
    askedAt: z.iso.datetime(),
    missingFields: z.array(z.string().trim().min(1)).min(1),
    question: z.string().trim().min(1).max(500),
  })
  .strict();

export type LiveClarification = z.infer<typeof liveClarificationSchema>;

export const verifiedMerchantOfferSchema = z
  .object({
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    expiresAt: z.iso.datetime(),
    feesMinor: z.number().int().nonnegative(),
    merchantName: z.string().trim().min(1),
    merchantUrl: z.url(),
    observedAt: z.iso.datetime(),
    productName: z.string().trim().min(1),
    quantity: z.number().int().positive(),
    quotedColor: z.string().trim().min(1),
    quotedSize: z.string().trim().min(1),
    quoteTotalMinor: z.number().int().nonnegative(),
    sku: z.string().trim().min(1),
    source: z.literal("merchant_product_json"),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    unitPriceMinor: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((offer, context) => {
    if (
      offer.unitPriceMinor * offer.quantity + offer.feesMinor !==
      offer.quoteTotalMinor
    ) {
      context.addIssue({
        code: "custom",
        message: "Verified offer total does not match its line-item arithmetic",
      });
    }
  });

export type VerifiedMerchantOffer = z.infer<typeof verifiedMerchantOfferSchema>;

export const merchantCandidateSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    executionEligible: z.boolean(),
    merchantName: z.string().min(1),
    optionLabel: z.string().min(1),
    productName: z.string().min(1),
    sku: z.string().min(1),
    totalMinor: z.number().int().nonnegative(),
  })
  .strict();

export type MerchantCandidate = z.infer<typeof merchantCandidateSchema>;

export const sensoCitationSchema = z
  .object({
    chunkIndex: z.number().int().nonnegative(),
    chunkText: z.string().min(1),
    contentId: z.string().min(1),
    id: z.uuid(),
    rank: z.number().int().positive(),
    score: z.number().min(0).max(1),
    sourceType: z.string().min(1),
    title: z.string().min(1),
    versionId: z.string().nullable(),
  })
  .strict();

export type SensoCitation = z.infer<typeof sensoCitationSchema>;

export const evidenceSearchSchema = z
  .object({
    answer: z.string(),
    citations: z.array(sensoCitationSchema),
    kind: z.enum(["merchant", "variant"]),
    query: z.string().min(1),
  })
  .strict();

export const evidenceAuthorizationSchema = z
  .object({
    allowedSkus: z.array(z.string().min(1)).min(1),
    citationIds: z.array(z.uuid()).min(1),
    contentId: z.string().min(1),
    freshUntil: z.iso.datetime(),
    merchantDomain: z.string().min(1),
    merchantStatus: z.literal("approved"),
    observedAt: z.iso.datetime(),
    productHandle: z.string().min(1),
    recordDigest: z.string().regex(/^[a-f0-9]{64}$/),
    schemaVersion: z.literal(1),
    versionId: z.string().min(1),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      new Date(record.freshUntil).getTime() <=
      new Date(record.observedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        message: "Evidence freshness must end after its observation time",
      });
    }
  });

export const evidenceBundleSchema = z
  .object({
    authorization: evidenceAuthorizationSchema,
    merchant: evidenceSearchSchema,
    retrievedAt: z.iso.datetime(),
    variant: evidenceSearchSchema,
  })
  .strict();

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

export const policyReasonCodeSchema = z.enum([
  "PASS",
  "MISSING_REQUIRED_FIELD",
  "PRODUCT_MISMATCH",
  "MERCHANT_MISMATCH",
  "DENOMINATION_MISMATCH",
  "COLOR_MISMATCH",
  "SIZE_MISMATCH",
  "QUANTITY_MISMATCH",
  "BUDGET_EXCEEDED",
  "EVIDENCE_STALE",
  "QUOTE_EXPIRED",
  "MERCHANT_EVIDENCE_MISSING",
  "VARIANT_EVIDENCE_MISSING",
]);

export const policyCheckSchema = z
  .object({
    code: z.string().min(1),
    detail: z.string().min(1),
    status: z.enum(["pass", "fail"]),
  })
  .strict();

export const policyDecisionSchema = z
  .object({
    checks: z.array(policyCheckSchema),
    decidedAt: z.iso.datetime(),
    quoteTotalMinor: z.number().int().nonnegative().nullable(),
    reason: z.string().min(1),
    reasonCode: policyReasonCodeSchema,
    status: z.enum(["pass", "refuse"]),
  })
  .strict();

export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export const approvalArtifactSchema = z
  .object({
    budgetMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    evidenceIds: z.array(z.uuid()).min(2),
    evidenceContentId: z.string().min(1),
    evidenceFreshUntil: z.iso.datetime(),
    evidenceRetrievedAt: z.iso.datetime(),
    evidenceRecordDigest: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceVersionId: z.string().min(1),
    feesMinor: z.number().int().nonnegative(),
    merchantName: z.string().min(1),
    merchantUrl: z.url().nullable(),
    productName: z.string().min(1),
    quantity: z.number().int().positive(),
    quoteExpiresAt: z.iso.datetime(),
    quoteObservedAt: z.iso.datetime(),
    quoteTotalMinor: z.number().int().nonnegative(),
    quotedColor: z.string().min(1),
    quotedSize: z.string().min(1),
    requestId: z.uuid(),
    sku: z.string().min(1),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    unitPriceMinor: z.number().int().nonnegative(),
  })
  .strict();

export type ApprovalArtifact = z.infer<typeof approvalArtifactSchema>;

export const livePravaSessionSchema = z
  .object({
    approvalUrl: z.url(),
    claim: z.literal("payment_mechanics_only"),
    createdAt: z.iso.datetime(),
    credentialsReady: z.boolean(),
    expiresAt: z.iso.datetime(),
    merchantAttempt: z
      .object({
        adapter: z.literal("bones_coffee_shopify_gift_card_v1"),
        attemptedAt: z.iso.datetime(),
        checkoutUrlDigest: z.string().regex(/^[a-f0-9]{64}$/),
        declineCode: z.enum([
          "CARD_DECLINED",
          "PAYMENT_NOT_PROCESSED",
          "PAYMENT_DETAILS_REJECTED",
        ]),
        merchantHost: z.literal("www.bonescoffee.com"),
        noOrderCreated: z.literal(true),
        outcome: z.literal("declined"),
        paymentSubmitted: z.literal(true),
      })
      .strict()
      .nullable()
      .optional(),
    mode: z.literal("sandbox"),
    providerEvents: z
      .array(
        z
          .object({
            finishedAt: z.iso.datetime(),
            operation: z.enum([
              "create_session",
              "health",
              "payment_result",
              "report_status",
              "revoke_session",
            ]),
            responseId: z.string().min(1).nullable(),
            startedAt: z.iso.datetime(),
            status: z.number().int().min(100).max(599),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    redactedSessionRef: z.string().min(32),
    report: z
      .object({
        acknowledgedAt: z.iso.datetime(),
        txnStatus: z.literal("DECLINED"),
        visaConfirmation: z.literal("SUCCESS"),
      })
      .strict()
      .nullable()
      .optional(),
    reportOperation: z
      .object({
        idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
        status: z.enum([
          "reporting",
          "reported",
          "report_failed",
          "report_unknown",
        ]),
        updatedAt: z.iso.datetime(),
      })
      .strict()
      .nullable()
      .optional(),
    status: z.enum([
      "pending",
      "processing",
      "awaiting_result",
      "completed",
      "failed",
      "revoked",
    ]),
    txnRefId: z.string().min(1).nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type LivePravaSession = z.infer<typeof livePravaSessionSchema>;

export const auditEventSchema = z
  .object({
    actorType: z.enum([
      "user",
      "openai",
      "senso",
      "code",
      "manager",
      "system",
      "prava",
      "browser",
    ]),
    createdAt: z.iso.datetime(),
    eventType: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
    sequence: z.number().int().positive(),
  })
  .strict();

export type AuditEvent = z.infer<typeof auditEventSchema>;

export interface LiveApprovalSnapshot {
  approvedAt: string | null;
  artifact: ApprovalArtifact;
  artifactHash: string;
  expiresAt: string;
}

export const pravaSessionOperationSchema = z
  .object({
    hasResponseId: z.boolean(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    status: z.enum(["creating", "created", "failed", "unknown"]),
    transportCode: z.string().min(1).max(100).nullable(),
    updatedAt: z.iso.datetime(),
    vendorCode: z.string().min(1).max(200).nullable(),
  })
  .strict();

export type PravaSessionOperation = z.infer<typeof pravaSessionOperationSchema>;

export interface LiveRequestSnapshot {
  approval: LiveApprovalSnapshot | null;
  audit: AuditEvent[];
  clarification: LiveClarification | null;
  createdAt: string;
  evidence: EvidenceBundle | null;
  expiresAt: string;
  id: string;
  intent: PurchaseIntent | null;
  merchantCandidates: MerchantCandidate[];
  offer: VerifiedMerchantOffer | null;
  policyDecision: PolicyDecision | null;
  prava: LivePravaSession | null;
  pravaSessionOperation?: PravaSessionOperation | null;
  publicId: string;
  requestText: string;
  source: "linq" | "web";
  state: LiveRequestState;
  updatedAt: string;
  version: number;
}

export const createLiveRequestInputSchema = z
  .object({
    requestText: z.string().trim().min(12).max(4_000),
    source: z.enum(["linq", "web"]).default("web"),
  })
  .strict();

export type CreateLiveRequestInput = z.input<
  typeof createLiveRequestInputSchema
>;
