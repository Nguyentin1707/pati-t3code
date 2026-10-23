import type { SidebarThreadSummary } from "../../types";
import { isThreadNeedingAttention, resolveSidebarThreadStatus } from "../Sidebar.logic";

type AttentionThreadInput = Parameters<typeof resolveSidebarThreadStatus>[0] &
  Pick<SidebarThreadSummary, "archivedAt"> & {
    readonly lineage: Pick<SidebarThreadSummary["lineage"], "relationshipToParent">;
  };

/**
 * Subagent threads are skipped because their requests already surface on the
 * parent row, which is also what the badge counts.
 */
export function isAttentionThread(thread: AttentionThreadInput): boolean {
  return (
    thread.archivedAt === null &&
    thread.lineage.relationshipToParent !== "subagent" &&
    isThreadNeedingAttention(resolveSidebarThreadStatus(thread))
  );
}

/**
 * The next attention thread after the open one in sidebar order, wrapping
 * around. Returns null when no other thread needs you.
 */
export function resolveNextAttentionThreadKey(input: {
  orderedThreadKeys: readonly string[];
  attentionThreadKeys: ReadonlySet<string>;
  currentThreadKey: string | null;
}): string | null {
  const { orderedThreadKeys, attentionThreadKeys, currentThreadKey } = input;
  const length = orderedThreadKeys.length;
  const currentIndex = currentThreadKey === null ? -1 : orderedThreadKeys.indexOf(currentThreadKey);
  for (let step = 1; step <= length; step += 1) {
    const key = orderedThreadKeys[(currentIndex + step + length) % length];
    if (key !== undefined && key !== currentThreadKey && attentionThreadKeys.has(key)) {
      return key;
    }
  }
  return null;
}
