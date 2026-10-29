"use client";

import Link from "next/link";
import type { StaffNotification } from "src/api/notifications.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { NOTIFICATION_KIND } from "./notification-display";

/**
 * One notice as a single large link into the record. Unread is carried by a
 * text label and weight, not by colour alone; the title is content (an order
 * number, a SKU that may be Arabic), so it is `dir="auto"`.
 */
export function NotificationItem({ notification, onOpen }: { notification: StaffNotification; onOpen?: (notification: StaffNotification) => void }) {
  const format = useStoreFormat();
  const kind = NOTIFICATION_KIND[notification.type];
  const Icon = kind.icon;
  return (
    <Link
      href={notification.link}
      onClick={() => onOpen?.(notification)}
      className="flex min-h-[var(--st-tap-min)] items-start gap-3 px-3 py-2.5 transition-colors duration-[var(--st-duration-fast)] hover:bg-[var(--st-canvas)]"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--st-ink-muted)]" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[12px] uppercase tracking-wide text-[var(--st-ink-muted)]">{kind.label}</span>
          {notification.read ? null : <span className="text-[12px] font-semibold text-[var(--st-accent)]">Unread</span>}
        </span>
        <span dir="auto" className={`block break-words ${notification.read ? "" : "font-semibold"}`}>
          {notification.title}
        </span>
        {notification.body ? (
          <span dir="auto" className="block break-words text-[13px] text-[var(--st-ink-muted)]">
            {notification.body}
          </span>
        ) : null}
        <span className="block text-[12px] text-[var(--st-ink-muted)]">{format.dateTime(notification.at)}</span>
      </span>
    </Link>
  );
}
