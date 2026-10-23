import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isAttentionThread, resolveNextAttentionThreadKey } from "./attentionNavigation";

const ordered = ["a", "b", "c", "d", "e"];

describe("resolveNextAttentionThreadKey", () => {
  it("walks attention threads in sidebar order and skips the rest", () => {
    const attention = new Set(["b", "d"]);
    expect(
      resolveNextAttentionThreadKey({
        orderedThreadKeys: ordered,
        attentionThreadKeys: attention,
        currentThreadKey: "a",
      }),
    ).toBe("b");
    expect(
      resolveNextAttentionThreadKey({
        orderedThreadKeys: ordered,
        attentionThreadKeys: attention,
        currentThreadKey: "b",
      }),
    ).toBe("d");
    expect(
      resolveNextAttentionThreadKey({
        orderedThreadKeys: ordered,
        attentionThreadKeys: attention,
        currentThreadKey: "c",
      }),
    ).toBe("d");
  });

  it("wraps from the last attention thread back to the first", () => {
    expect(
      resolveNextAttentionThreadKey({
        orderedThreadKeys: ordered,
        attentionThreadKeys: new Set(["b", "d"]),
        currentThreadKey: "d",
      }),
    ).toBe("b");
    expect(
      resolveNextAttentionThreadKey({
        orderedThreadKeys: ordered,
        attentionThreadKeys: new Set(["b", "d"]),
        currentThreadKey: "e",
      }),
    ).toBe("b");
  });

  it("starts at the first attention thread when no thread is open", () => {
    expect(
      resolveNextAttentionThreadKey({
        orderedThreadKeys: ordered,
        attentionThreadKeys: new Set(["c", "d"]),
        currentThreadKey: null,
      }),
    ).toBe("c");
    expect(
      resolveNextAttentionThreadKey({
        orderedThreadKeys: ordered,
        attentionThreadKeys: new Set(["c", "d"]),
        currentThreadKey: "not-in-sidebar",
      }),
    ).toBe("c");
  });

  it("does nothing when no other thread needs you", () => {
    expect(
      resolveNextAttentionThreadKey({
        orderedThreadKeys: ordered,
        attentionThreadKeys: new Set(),
        currentThreadKey: "a",
      }),
    ).toBeNull();
    expect(
      resolveNextAttentionThreadKey({
        orderedThreadKeys: ordered,
        attentionThreadKeys: new Set(["c"]),
        currentThreadKey: "c",
      }),
    ).toBeNull();
  });

  it("ignores attention keys the sidebar is not showing", () => {
    expect(
      resolveNextAttentionThreadKey({
        orderedThreadKeys: ordered,
        attentionThreadKeys: new Set(["hidden"]),
        currentThreadKey: "a",
      }),
    ).toBeNull();
  });
});

describe("isAttentionThread", () => {
  const runtime = {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };
  const base = {
    archivedAt: null,
    lineage: { relationshipToParent: null },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    blockedOnThreadWait: false,
    runtime: null,
  };

  it("counts approval, input, failed and limited threads", () => {
    expect(isAttentionThread({ ...base, hasPendingApprovals: true })).toBe(true);
    expect(isAttentionThread({ ...base, hasPendingUserInput: true })).toBe(true);
    expect(isAttentionThread({ ...base, pendingSubagentRequest: "approval" as const })).toBe(true);
    expect(
      isAttentionThread({
        ...base,
        runtime: { ...runtime, status: "failed" as const, lastErrorClass: "usage_limit" as const },
      }),
    ).toBe(true);
  });

  it("leaves out working, finished, archived and subagent threads", () => {
    expect(isAttentionThread(base)).toBe(false);
    expect(isAttentionThread({ ...base, runtime })).toBe(false);
    expect(
      isAttentionThread({ ...base, hasPendingApprovals: true, archivedAt: "2026-01-01" }),
    ).toBe(false);
    expect(
      isAttentionThread({
        ...base,
        hasPendingApprovals: true,
        lineage: { relationshipToParent: "subagent" as const },
      }),
    ).toBe(false);
  });
});
