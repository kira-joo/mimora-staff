"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import Link from "next/link";
import type { ReactNode } from "react";
import { todayEndpoint, type TodayData } from "src/api/today.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { NotificationItem } from "src/features/notifications/notification-item";
import { waitLabel } from "src/features/payments/payment-ageing";
import { OrderStatusSignal } from "src/features/status/status-signal";
import type { OrderStatus } from "src/api/orders.endpoints";

const REFRESH_MS = 60_000;

/**
 * Today — the operational landing page. Large figures, large links, no
 * decorative charts: what needs doing, how many, and one tap to the queue that
 * does it. Each panel renders only if the server sent that section — the
 * server omits what the caller may not read, so there is no permission logic
 * here to get wrong. Refreshes itself every minute.
 */
export function TodayView() {
  const query = useRequesterQuery({ endpoint: todayEndpoint, queryOptions: { refetchInterval: REFRESH_MS } });
  return (
    <PageShell title="Today" description="What needs doing right now." maxWidth="5xl">
      <QueryState query={query} entityName="today">
        {(today) => <TodayPanels today={today} />}
      </QueryState>
    </PageShell>
  );
}

function Panel({ id, title, href, linkLabel, children }: { id: string; title: string; href?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-md border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {href ? (
          <Link href={href} className="inline-flex min-h-[var(--st-tap-min)] items-center text-[13px] font-medium text-[var(--st-accent)] underline underline-offset-2">
            {linkLabel ?? "Open"}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** A figure that is also a link: the whole row is the target. */
function FigureLink({ href, label, value, emphasis }: { href: string; label: ReactNode; value: number; emphasis?: boolean }) {
  return (
    <Link href={href} className="flex min-h-[var(--st-tap-min)] items-center justify-between gap-3 border-t border-[var(--st-line)] px-1 py-1 transition-colors duration-[var(--st-duration-fast)] first:border-t-0 hover:bg-[var(--st-canvas)]">
      <span className={emphasis ? "font-medium" : "text-[var(--st-ink-muted)]"}>{label}</span>
      <span className={`st-figure text-2xl ${emphasis ? "font-semibold" : "text-[var(--st-ink-muted)]"}`}>{value}</span>
    </Link>
  );
}

function TodayPanels({ today }: { today: TodayData }) {
  const format = useStoreFormat();
  const { orders, payments, returns, stock, sales, notifications } = today;
  const panelCount = [orders, payments, returns, stock, sales, notifications].filter(Boolean).length;

  if (panelCount === 0) return <p className="text-[var(--st-ink-muted)]">Nothing to show for your role yet.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {orders ? (
        <Panel id="today-orders" title="Orders to move" href={AppRoute.ORDERS} linkLabel="All orders">
          <div>
            {orders.open.map(({ status, count }) => (
              <FigureLink key={status} href={`${AppRoute.ORDERS}?status=${status}`} label={<OrderStatusSignal status={status as OrderStatus} />} value={count} emphasis={count > 0} />
            ))}
          </div>
          <p className="text-[13px] text-[var(--st-ink-muted)]">
            <span className="st-figure font-semibold text-[var(--st-ink)]">{orders.placedToday}</span> placed today
          </p>
        </Panel>
      ) : null}

      {payments ? (
        <Panel id="today-payments" title="Payments to verify" href={AppRoute.PAYMENTS} linkLabel="Open the queue">
          <FigureLink href={AppRoute.PAYMENTS} label="Waiting for a decision" value={payments.count} emphasis={payments.count > 0} />
          <p className="text-[13px] text-[var(--st-ink-muted)]">
            {payments.count === 0 || payments.oldestWaitingHours === null ? "Nothing is waiting." : `The oldest has waited ${waitLabel(payments.oldestWaitingHours)}.`}
          </p>
        </Panel>
      ) : null}

      {returns ? (
        <Panel id="today-returns" title="Returns" href={AppRoute.RETURNS} linkLabel="All returns">
          <div>
            <FigureLink href={AppRoute.RETURNS} label="Requested — need a decision" value={returns.requested} emphasis={returns.requested > 0} />
            <FigureLink href={AppRoute.RETURNS} label="Approved — awaiting the parcel" value={returns.approved} emphasis={returns.approved > 0} />
            <FigureLink href={AppRoute.RETURNS} label="Received — awaiting refund" value={returns.received} emphasis={returns.received > 0} />
          </div>
        </Panel>
      ) : null}

      {stock ? (
        <Panel id="today-stock" title="Stock" href={AppRoute.INVENTORY} linkLabel="Inventory">
          <div>
            <FigureLink href={AppRoute.INVENTORY} label="Out of stock" value={stock.outOfStock} emphasis={stock.outOfStock > 0} />
            <FigureLink href={AppRoute.INVENTORY} label="Running low" value={stock.lowStock} emphasis={stock.lowStock > 0} />
          </div>
        </Panel>
      ) : null}

      {sales ? (
        <Panel id="today-sales" title="Sales today" href={AppRoute.REPORTS} linkLabel="Reports">
          <dl className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <dt className="text-[13px] text-[var(--st-ink-muted)]">Orders</dt>
              <dd className="st-figure text-2xl font-semibold">{sales.orderCount}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[13px] text-[var(--st-ink-muted)]">Revenue, net of refunds</dt>
              <dd className="st-figure break-words text-2xl font-semibold">{format.money(sales.revenue)}</dd>
            </div>
          </dl>
        </Panel>
      ) : null}

      {notifications ? (
        <Panel id="today-notifications" title={`Notifications${notifications.unread > 0 ? ` (${notifications.unread} unread)` : ""}`} href={AppRoute.NOTIFICATIONS} linkLabel="View all">
          {notifications.recent.length === 0 ? (
            <p className="text-[var(--st-ink-muted)]">Nothing new.</p>
          ) : (
            <div className="-mx-4 divide-y divide-[var(--st-line)] border-t border-[var(--st-line)]">
              {notifications.recent.map((notification) => (
                <NotificationItem key={notification._id} notification={notification} />
              ))}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
