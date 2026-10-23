import {
  type PendingSubagentRequest,
  presentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { pendingSubagentRequestsByThread } from "@t3tools/client-runtime/state/threads";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useEnvironmentIds } from "../state/environments";
import { environmentShell } from "../state/shell";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  threadNotificationTag,
  unlockNotificationAudio,
} from "../threadNotifications";
import { isThreadNeedingAttention, resolveSidebarThreadStatus } from "./Sidebar.logic";
import { toastManager } from "./ui/toast";

export function ThreadNotificationCoordinator() {
  const environmentIds = useEnvironmentIds();
  const mode = useClientSettings((settings) => settings.notificationMode);
  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId; notification: Notification }>(),
  );
  const attentionCounts = useRef(new Map<EnvironmentId, number>());
  const shownBadge = useRef(0);
  const syncBadge = () => {
    let total = 0;
    for (const count of attentionCounts.current.values()) total += count;
    if (total === shownBadge.current) return;
    shownBadge.current = total;
    setNotificationBadge(total);
  };
  const onAttentionCount = (environmentId: EnvironmentId, count: number) => {
    if (count > 0) attentionCounts.current.set(environmentId, count);
    else attentionCounts.current.delete(environmentId);
    syncBadge();
  };
  const onNotification = (environmentId: EnvironmentId, notification: Notification) => {
    pending.current.get(notification.tag)?.notification.close();
    pending.current.set(notification.tag, { environmentId, notification });
  };

  useEffect(() => {
    const activeIds = new Set(environmentIds);
    for (const [tag, entry] of pending.current) {
      if (activeIds.has(entry.environmentId)) continue;
      entry.notification.close();
      pending.current.delete(tag);
    }
    for (const environmentId of attentionCounts.current.keys()) {
      if (!activeIds.has(environmentId)) attentionCounts.current.delete(environmentId);
    }
    syncBadge();
  }, [environmentIds, syncBadge]);

  useEffect(() => {
    // Focusing the window only dismisses delivered OS notifications. The badge counts threads
    // that still need the user, so it follows thread state rather than window focus.
    const dismiss = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear();
    };
    dismiss();
    if (!hasDesktopNotifications(mode)) return;
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(dismiss);
    window.addEventListener("focus", dismiss);
    return () => {
      unsubscribe?.();
      window.removeEventListener("focus", dismiss);
      dismiss();
    };
  }, [mode]);

  useEffect(() => {
    if (!hasNotificationSound(mode)) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [mode]);

  return environmentIds.map((environmentId) => (
    <EnvironmentNotifications
      key={environmentId}
      environmentId={environmentId}
      onNotification={onNotification}
      onAttentionCount={onAttentionCount}
    />
  ));
}

interface NotificationState {
  readonly raw: OrchestrationV2ThreadShell;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly attention: string | null;
  readonly countsTowardBadge: boolean;
  readonly completion: number | null;
}

function EnvironmentNotifications({
  environmentId,
  onNotification,
  onAttentionCount,
}: {
  environmentId: EnvironmentId;
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
  onAttentionCount: (environmentId: EnvironmentId, count: number) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const threads =
    shell.status === "live" && Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : null;
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const navigate = useNavigate();
  const { environmentId: activeEnvironmentId, threadId: activeThreadId } = useParams({
    strict: false,
  });
  const previous = useRef(new Map<ThreadId, NotificationState>());

  useEffect(() => {
    if (threads === null) {
      previous.current.clear();
      onAttentionCount(environmentId, 0);
      return;
    }
    const notificationsEnabled = mode !== "off" || inAppNotificationsEnabled;
    let attentionCount = 0;
    const next = new Map<ThreadId, NotificationState>();
    const subagentRequests = pendingSubagentRequestsByThread(threads);
    for (const rawThread of threads) {
      if (rawThread.lineage.relationshipToParent === "subagent") continue;
      const prior = previous.current.get(rawThread.id);
      const subagentRequest = subagentRequests.get(rawThread.id) ?? null;
      if (prior?.raw === rawThread && prior.subagentRequest === subagentRequest) {
        next.set(rawThread.id, prior);
        continue;
      }
      const thread = presentThreadShell(environmentId, rawThread, subagentRequest);
      let status = resolveSidebarThreadStatus(thread);
      if (status === "ready" && thread.latestRun?.status === "failed") status = "failed";
      const attention = isThreadNeedingAttention(status)
        ? `${thread.latestRun?.runId ?? ""}:${status}`
        : null;
      const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
      const completion =
        status === "ready" &&
        thread.latestRun?.status === "completed" &&
        Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, {
        raw: rawThread,
        subagentRequest,
        attention,
        countsTowardBadge: attention !== null && thread.archivedAt === null,
        completion,
      });
      if (!prior || thread.archivedAt !== null) continue;
      const kind =
        attention && attention !== prior.attention
          ? "input"
          : !rawThread.latestRunStopRequested &&
              completion !== null &&
              (prior.completion === null || completion > prior.completion)
            ? "completion"
            : null;
      if (!kind || !notificationsEnabled) continue;
      const title =
        kind === "completion"
          ? "Thread completed"
          : status === "approval"
            ? "Approval needed"
            : status === "limited"
              ? "Usage limit reached"
              : status === "failed"
                ? "Thread failed"
                : "Input needed";
      if (hasNotificationSound(mode)) {
        void playNotificationSound(kind, () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      }
      if (
        inAppNotificationsEnabled &&
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        (activeEnvironmentId !== environmentId || activeThreadId !== thread.id)
      ) {
        const toastId = toastManager.add({
          type: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
          title,
          description: thread.title,
          data: {
            hideCopyButton: true,
            leadingIcon:
              kind === "completion" ? (
                <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
              ) : status === "approval" ? (
                <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
              ) : status === "failed" ? (
                <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
              ) : (
                <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
              ),
          },
          actionProps: {
            children: "Open thread",
            onClick: () => {
              toastManager.close(toastId);
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId: thread.id },
              });
            },
          },
        });
        continue;
      }
      if (
        !hasDesktopNotifications(mode) ||
        (document.visibilityState === "visible" && document.hasFocus()) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        continue;
      try {
        const notification = new Notification(title, {
          body: thread.title,
          tag: threadNotificationTag(environmentId, thread.id),
          silent: true,
        });
        onNotification(environmentId, notification);
        notification.addEventListener("click", () => {
          notification.close();
          window.focus();
          void window.desktopBridge?.revealWindow?.().catch(() => undefined);
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId, threadId: thread.id },
          });
        });
      } catch {
        // Some browsers expose Notification but reject desktop presentation.
      }
    }
    previous.current = next;
    for (const entry of next.values()) if (entry.countsTowardBadge) attentionCount += 1;
    onAttentionCount(environmentId, attentionCount);
  }, [
    activeEnvironmentId,
    activeThreadId,
    environmentId,
    inAppNotificationsEnabled,
    mode,
    navigate,
    onAttentionCount,
    onNotification,
    threads,
  ]);

  return null;
}
