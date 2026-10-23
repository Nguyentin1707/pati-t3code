import type { ChatShortcutHandler } from "./useChatShortcuts";

/**
 * Presses the approval drawer's own button so the shortcut can never act on an
 * approval the user cannot see: the typing guard hides the drawer while the
 * user is typing, and the button is disabled while a response is in flight.
 * Returning false lets the key event through when there is nothing to press.
 */
export function respondToVisibleApproval(decision: "accept" | "decline"): ChatShortcutHandler {
  return ({ event }) => {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-chat-composer-top-drawer] button[data-approval-decision="${decision}"]:not(:disabled)`,
    );
    if (!button) return false;
    if (!event.repeat) button.click();
  };
}
