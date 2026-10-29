"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { listNotificationsEndpoint, markAllNotificationsReadEndpoint, markNotificationReadEndpoint, unreadNotificationCountEndpoint, type StaffNotification } from "src/api/notifications.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { bellLabel, unreadBadge } from "./notification-display";
import { NotificationItem } from "./notification-item";

const POLL_MS = 60_000;
const PANEL_SIZE = 8;

/**
 * The header bell: an unread badge (a number AND the accessible name, never
 * colour alone) and a panel of the latest notices. Shown only to a staff member
 * holding Notification.read; the API enforces it again, and filters the feed by
 * what each kind of notice may reveal to this person.
 *
 * Polls the count once a minute — a bell that needs a reload to tick is a bell
 * nobody trusts — and refreshes it after anything is marked read.
 */
export function NotificationBell() {
  const can = usePermission();
  if (!can(CustomPermission.NOTIFICATION_READ)) return null;
  return <BellWithPanel />;
}

function BellWithPanel() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const count = useRequesterQuery({
    endpoint: unreadNotificationCountEndpoint,
    queryOptions: { refetchInterval: POLL_MS, meta: { skipErrorToast: true } },
  });
  const unread = count.data?.unread ?? 0;
  const badge = unreadBadge(unread);

  const list = useRequesterQuery({
    endpoint: listNotificationsEndpoint,
    options: { query: { page: 1, limit: PANEL_SIZE } },
    queryOptions: { enabled: open, meta: { skipErrorToast: true } },
  });

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(notification: StaffNotification) {
    setOpen(false);
    if (notification.read) return;
    await requester(markNotificationReadEndpoint, { params: { id: notification._id } }).catch(() => undefined);
    await queryClient.invalidateQueries();
  }

  async function markAll() {
    const ok = await runAction(() => requester(markAllNotificationsReadEndpoint, {}));
    if (ok) await queryClient.invalidateQueries();
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={bellLabel(unread)}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex h-[var(--st-tap-min)] min-w-[var(--st-tap-min)] items-center justify-center gap-1.5 border border-[var(--st-line-strong)] px-2.5 text-[var(--st-ink)] transition-colors duration-[var(--st-duration-fast)] hover:bg-[var(--st-canvas)]"
      >
        <Bell aria-hidden="true" className="size-4" />
        {badge ? (
          <span aria-hidden="true" className="st-figure min-w-5 bg-[var(--st-ink)] px-1 text-center text-[12px] font-semibold leading-5 text-[var(--st-surface)]">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div id="notification-panel" role="region" aria-label="Notifications" className="absolute end-0 top-full z-30 mt-1 w-[min(22rem,calc(100vw-1.5rem))] border border-[var(--st-line-strong)] bg-[var(--st-surface)] shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--st-line)] px-3 py-1">
            <h2 className="text-[14px] font-semibold">Notifications</h2>
            <button type="button" onClick={markAll} disabled={unread === 0} className="min-h-[var(--st-tap-min)] px-1 text-[13px] font-medium text-[var(--st-accent)] underline underline-offset-2 disabled:no-underline disabled:opacity-50">
              Mark all read
            </button>
          </div>
          <div className="max-h-[60dvh] overflow-y-auto divide-y divide-[var(--st-line)]">
            {list.isLoading ? <p className="px-3 py-4 text-[var(--st-ink-muted)]">Loading…</p> : null}
            {list.isError ? <p role="alert" className="px-3 py-4 text-[var(--st-ink-muted)]">Could not load notifications.</p> : null}
            {list.data && list.data.data.length === 0 ? <p className="px-3 py-4 text-[var(--st-ink-muted)]">Nothing yet. New orders, payment proofs, returns and low stock show up here.</p> : null}
            {list.data?.data.map((notification) => (
              <NotificationItem key={notification._id} notification={notification} onOpen={markRead} />
            ))}
          </div>
          <Link href={AppRoute.NOTIFICATIONS} onClick={() => setOpen(false)} className="flex min-h-[var(--st-tap-min)] items-center justify-center border-t border-[var(--st-line)] text-[13px] font-medium text-[var(--st-accent)] underline underline-offset-2">
            View all notifications
          </Link>
        </div>
      ) : null}
    </div>
  );
}
