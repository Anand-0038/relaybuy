import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveRequestSnapshot } from "../types";

const mocks = vi.hoisted(() => ({
  getByApprovalTokenHash: vi.fn(),
  getByRequestTokenHash: vi.fn(),
}));

vi.mock("@/live/env", () => ({
  getLiveEnvironment: () => ({
    APPROVAL_TOKEN_PEPPER: "p".repeat(32),
  }),
}));

vi.mock("@/live/repository", () => ({
  LiveRepositoryError: class LiveRepositoryError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  LiveRequestRepository: class LiveRequestRepository {
    getByApprovalTokenHash = mocks.getByApprovalTokenHash;
    getByRequestTokenHash = mocks.getByRequestTokenHash;
  },
}));

import {
  authorizeLiveApprovalCapability,
  authorizeLiveRequestCapability,
} from "../service";

const requestId = "00000000-0000-4000-8000-000000000001";
const token = "a".repeat(43);

describe("live approval capability authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binds protected request operations to the approval token's request", async () => {
    mocks.getByApprovalTokenHash.mockResolvedValue({
      approval: { approvedAt: "2026-07-31T18:00:00.000Z" },
      id: requestId,
    } as unknown as LiveRequestSnapshot);

    await expect(
      authorizeLiveApprovalCapability(requestId, token),
    ).resolves.toMatchObject({ id: requestId });
    await expect(
      authorizeLiveApprovalCapability(
        "00000000-0000-4000-8000-000000000002",
        token,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("binds pre-approval operations to the request owner capability", async () => {
    const requestToken = `rb_req_${"b".repeat(43)}`;
    mocks.getByRequestTokenHash.mockResolvedValue({
      id: requestId,
    } as LiveRequestSnapshot);

    await expect(
      authorizeLiveRequestCapability(requestId, requestToken),
    ).resolves.toMatchObject({ id: requestId });
    await expect(
      authorizeLiveRequestCapability(
        "00000000-0000-4000-8000-000000000002",
        requestToken,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires approval consumption before spend-capable operations", async () => {
    mocks.getByApprovalTokenHash.mockResolvedValue({
      approval: { approvedAt: null },
      id: requestId,
    } as unknown as LiveRequestSnapshot);

    await expect(
      authorizeLiveApprovalCapability(requestId, token),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a missing or malformed approval capability", async () => {
    await expect(
      authorizeLiveApprovalCapability(requestId, ""),
    ).rejects.toBeDefined();
    expect(mocks.getByApprovalTokenHash).not.toHaveBeenCalled();
  });
});
