"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listNotificationsEndpoint, markAllNotificationsReadEndpoint, markNotificationReadEndpoint, type StaffNotification } from "src/api/notifications.endpoints";
import { runAction } from "src/common/feedback/run-action";
import { NotificationItem } from "./notification-item";

const PAGE_SIZE = 25;

/** The full feed, newest first, paginated. Opening a notice marks it read. */
export function NotificationsPageView() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useRequesterQuery({
    endpoint: listNotificationsEndpoint,
    options: { query: { page, limit: PAGE_SIZE, ...(unreadOnly ? { unread: "true" as const } : {}) } },
  });

  async function markRead(notification: StaffNotification) {
    if (notification.read) return;
    await requester(markNotificationReadEndpoint, { params: { id: notification._id } }).catch(() => undefined);
    await queryClient.invalidateQueries();
  }

  async function markAll() {
    if (await runAction(() => requester(markAllNotificationsReadEndpoint, {}))) await queryClient.invalidateQueries();
  }

  return (
    <PageShell
      title="Notifications"
      description="New orders, payment proofs, return requests and stock running low."
      actions={
        <div className="flex flex-wrap gap-2">
          <CustomButton variant="outline" onClick={() => { setUnreadOnly((value) => !value); setPage(1); }} aria-pressed={unreadOnly}>
            {unreadOnly ? "Showing unread" : "Show unread only"}
          </CustomButton>
          <CustomButton variant="outline" onClick={markAll}>
            Mark all read
          </CustomButton>
        </div>
      }
    >
      <QueryState query={query} entityName="notifications">
        {(result) =>
          result.data.length === 0 ? (
            <p className="text-[var(--st-ink-muted)]">{unreadOnly ? "Nothing unread." : "Nothing yet."}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="divide-y divide-[var(--st-line)] rounded-md border border-[var(--st-line)] bg-[var(--st-surface)]">
                {result.data.map((notification) => (
                  <NotificationItem key={notification._id} notification={notification} onOpen={markRead} />
                ))}
              </div>
              <nav aria-label="Pages" className="flex items-center justify-between gap-3">
                <CustomButton variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  Newer
                </CustomButton>
                <span className="st-figure text-[13px] text-[var(--st-ink-muted)]">
                  Page {result.page ?? page} of {result.totalPages ?? 1}
                </span>
                <CustomButton variant="outline" disabled={page >= (result.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)}>
                  Older
                </CustomButton>
              </nav>
            </div>
          )
        }
      </QueryState>
    </PageShell>
  );
}
