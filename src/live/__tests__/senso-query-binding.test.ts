import { describe, expect, it } from "vitest";

import { bindSensoSearchQuery } from "../senso";

describe("Senso query binding", () => {
  it("adds every configured immutable record digest to the runtime query", () => {
    const query = bindSensoSearchQuery("merchant policy", [
      { recordDigest: "a".repeat(64) },
      { recordDigest: "b".repeat(64) },
    ]);

    expect(query).toBe(
      `merchant policy Return the policy record with evidence digest "${"a".repeat(64)}". Return the policy record with evidence digest "${"b".repeat(64)}".`,
    );
  });
});
