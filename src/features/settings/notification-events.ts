import { EMAILING_EVENT_TYPES, ORDER_EMAIL_EVENT_LABELS } from "src/server/engines/notifications/order-email-policy";

export interface EventOption {
  value: string;
  label: string;
}

/**
 * The choices for one notification rule's event: every event the server can actually email for, labelled, minus the
 * ones another rule already uses (two rules for one event would make the second dead — `isEmailEnabledFor` reads any
 * rule that ticks Email, but the screen should not invite the duplication).
 *
 * The row's OWN current value is always present. A rule saved before this screen offered a choice may name an event
 * the server does not email for (a typo, or a future event); hiding it would silently rewrite it on the next save, so
 * it stays selectable and says plainly that it sends nothing.
 */
export function notificationEventOptions(current: string, otherRowsUse: readonly string[]): EventOption[] {
  const taken = new Set(otherRowsUse.filter(Boolean));
  const options = EMAILING_EVENT_TYPES.filter((event) => event === current || !taken.has(event)).map((event) => ({ value: event, label: ORDER_EMAIL_EVENT_LABELS[event] ?? event }));
  if (current && !EMAILING_EVENT_TYPES.includes(current)) options.push({ value: current, label: `${current} (not supported — sends nothing)` });
  return options;
}
