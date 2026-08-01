import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { moneySchema } from "./money";

export const APPROVAL_TOKEN_MAX_TTL_MS = 10 * 60 * 1_000;

export const approvalQuoteBindingSchema = z
  .object({
    quoteId: z.string().trim().min(1),
    amount: moneySchema,
    merchantId: z.string().trim().min(1),
    variantId: z.string().trim().min(1),
  })
  .strict();

const approvalBindingSchema = z
  .object({
    requestId: z.string().trim().min(1),
    managerId: z.string().trim().min(1),
  })
  .extend(approvalQuoteBindingSchema.shape)
  .strict();

export const approvalValidationContextSchema = approvalBindingSchema;

export const issueApprovalTokenInputSchema = approvalBindingSchema
  .extend({
    issuedAt: z.date(),
    expiresAt: z.date(),
  })
  .superRefine(({ issuedAt, expiresAt }, context) => {
    const ttl = expiresAt.valueOf() - issuedAt.valueOf();

    if (ttl <= 0) {
      context.addIssue({
        code: "custom",
        message: "Approval token expiry must be after issuance",
        path: ["expiresAt"],
      });
    }

    if (ttl > APPROVAL_TOKEN_MAX_TTL_MS) {
      context.addIssue({
        code: "custom",
        message: "Approval token TTL cannot exceed ten minutes",
        path: ["expiresAt"],
      });
    }
  });

export const approvalTokenRecordSchema = approvalBindingSchema
  .extend({
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    usedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine(({ issuedAt, expiresAt }, context) => {
    const ttl = new Date(expiresAt).valueOf() - new Date(issuedAt).valueOf();

    if (ttl <= 0 || ttl > APPROVAL_TOKEN_MAX_TTL_MS) {
      context.addIssue({
        code: "custom",
        message: "Persisted approval TTL must be between zero and ten minutes",
        path: ["expiresAt"],
      });
    }
  });

export type IssueApprovalTokenInput = z.input<
  typeof issueApprovalTokenInputSchema
>;
export type ApprovalTokenRecord = z.infer<typeof approvalTokenRecordSchema>;
export type ApprovalQuoteBinding = z.infer<typeof approvalQuoteBindingSchema>;
export type ApprovalValidationContext = z.infer<
  typeof approvalValidationContextSchema
>;

export type ApprovalTokenErrorCode =
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "TOKEN_NOT_YET_VALID"
  | "TOKEN_USED"
  | "TOKEN_BINDING_MISMATCH"
  | "INVALID_APPROVAL";

export class ApprovalTokenError extends Error {
  constructor(
    public readonly code: ApprovalTokenErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApprovalTokenError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function parseRecord(record: ApprovalTokenRecord): ApprovalTokenRecord {
  const parsed = approvalTokenRecordSchema.safeParse(record);

  if (!parsed.success) {
    throw new ApprovalTokenError(
      "INVALID_APPROVAL",
      "Approval record is invalid",
      {
        cause: parsed.error,
      },
    );
  }

  return parsed.data;
}

function parseNow(now: Date): Date {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new ApprovalTokenError("INVALID_APPROVAL", "Current time is invalid");
  }

  return now;
}

function parseValidationContext(
  input: ApprovalValidationContext,
): ApprovalValidationContext {
  const parsed = approvalValidationContextSchema.safeParse(input);

  if (!parsed.success) {
    throw new ApprovalTokenError(
      "INVALID_APPROVAL",
      "Approval validation context is invalid",
      {
        cause: parsed.error,
      },
    );
  }

  return parsed.data;
}

function validationContextMatches(
  record: ApprovalTokenRecord,
  context: ApprovalValidationContext,
): boolean {
  return (
    record.requestId === context.requestId &&
    record.managerId === context.managerId &&
    record.quoteId === context.quoteId &&
    record.amount.amountMinor === context.amount.amountMinor &&
    record.amount.currency === context.amount.currency &&
    record.merchantId === context.merchantId &&
    record.variantId === context.variantId
  );
}

export function issueApprovalToken(input: IssueApprovalTokenInput): {
  token: string;
  record: ApprovalTokenRecord;
} {
  const parsed = issueApprovalTokenInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new ApprovalTokenError(
      "INVALID_APPROVAL",
      "Approval token input is invalid",
      {
        cause: parsed.error,
      },
    );
  }

  const token = randomBytes(32).toString("base64url");
  const record = approvalTokenRecordSchema.parse({
    requestId: parsed.data.requestId,
    quoteId: parsed.data.quoteId,
    managerId: parsed.data.managerId,
    amount: parsed.data.amount,
    merchantId: parsed.data.merchantId,
    variantId: parsed.data.variantId,
    tokenHash: hashToken(token),
    issuedAt: parsed.data.issuedAt.toISOString(),
    expiresAt: parsed.data.expiresAt.toISOString(),
    usedAt: null,
  });

  return { token, record };
}

export function validateApprovalToken(
  record: ApprovalTokenRecord,
  token: string,
  context: ApprovalValidationContext,
  now: Date,
): ApprovalTokenRecord {
  const validRecord = parseRecord(record);
  const validNow = parseNow(now);
  const validContext = parseValidationContext(context);
  const suppliedHash = Buffer.from(hashToken(token), "hex");
  const storedHash = Buffer.from(validRecord.tokenHash, "hex");

  if (!timingSafeEqual(suppliedHash, storedHash)) {
    throw new ApprovalTokenError("TOKEN_INVALID", "Approval token is invalid");
  }

  if (validRecord.usedAt !== null) {
    throw new ApprovalTokenError(
      "TOKEN_USED",
      "Approval token has already been used",
    );
  }

  if (validNow.valueOf() < new Date(validRecord.issuedAt).valueOf()) {
    throw new ApprovalTokenError(
      "TOKEN_NOT_YET_VALID",
      "Approval token is not valid before issuance",
    );
  }

  if (validNow.valueOf() >= new Date(validRecord.expiresAt).valueOf()) {
    throw new ApprovalTokenError("TOKEN_EXPIRED", "Approval token has expired");
  }

  if (!validationContextMatches(validRecord, validContext)) {
    throw new ApprovalTokenError(
      "TOKEN_BINDING_MISMATCH",
      "Approval token no longer matches the current quote",
    );
  }

  return validRecord;
}

/**
 * Single-process reference store. Its synchronous compare-and-set section makes
 * consumption atomic within one JavaScript process. A production multi-instance
 * service must provide the same invariant with a database transaction.
 */
export class InMemoryApprovalTokenStore {
  readonly #recordsByHash = new Map<string, ApprovalTokenRecord>();

  add(record: ApprovalTokenRecord): void {
    const validRecord = parseRecord(record);

    if (this.#recordsByHash.has(validRecord.tokenHash)) {
      throw new ApprovalTokenError(
        "INVALID_APPROVAL",
        "Approval token already exists",
      );
    }

    this.#recordsByHash.set(validRecord.tokenHash, validRecord);
  }

  async consume(
    token: string,
    context: ApprovalValidationContext,
    now: Date,
  ): Promise<ApprovalTokenRecord> {
    const tokenHash = hashToken(token);
    const currentRecord = this.#recordsByHash.get(tokenHash);

    if (currentRecord === undefined) {
      throw new ApprovalTokenError(
        "TOKEN_INVALID",
        "Approval token is invalid",
      );
    }

    const validNow = parseNow(now);
    const validRecord = validateApprovalToken(
      currentRecord,
      token,
      context,
      validNow,
    );
    const consumedRecord = approvalTokenRecordSchema.parse({
      ...validRecord,
      usedAt: validNow.toISOString(),
    });

    this.#recordsByHash.set(tokenHash, consumedRecord);
    return consumedRecord;
  }
}
