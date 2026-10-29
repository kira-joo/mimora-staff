"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { Clock, List, Package, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getOrdersBoardEndpoint, transitionOrderEndpoint, type BoardCard, type BoardColumn, type FulfilmentMode, type OrderStatus } from "src/api/orders.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { useActionKeys } from "src/common/feedback/idempotency-key";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { OrderStatusSignal, PaymentStatusSignal } from "src/features/status/status-signal";
import { ORDER_STATUS, TONE_VAR } from "src/features/status/status-vocabulary";
import { ADVANCE_LABEL, advanceStepsFor, isOverdue, waitingLabel } from "./board-model";

const REFRESH_MS = 30_000;
const MODES: Array<{ value: FulfilmentMode | undefined; label: string }> = [
  { value: undefined, label: "All" },
  { value: "DELIVERY", label: "Delivery" },
  { value: "PICKUP", label: "Pickup" },
];
const LINK_BUTTON =
  "inline-flex min-h-[var(--st-tap-min)] items-center gap-2 border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-4 font-medium hover:bg-[var(--st-accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--st-focus)]";

/** A value that follows `value` after it has stopped changing for `ms` — so typing in the search box is one request, not one per key. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * The orders board — operations mode. One column per working status, the order that has waited longest at the top,
 * each card a glance (number, who, where, how many, how long) and one big button for the next step. Order status and
 * payment status are two separate chips on every card: a COD order moves while unpaid, and a transfer order can be
 * paid before it is confirmed.
 *
 * The one-tap button is the same transition the order page uses, with its own Idempotency-Key. Cancelling is not one
 * tap (it needs a reason), so a card links to its order for that.
 */
export function OrdersBoard() {
  const [mode, setMode] = useState<FulfilmentMode | undefined>();
  const [search, setSearch] = useState("");
  const settledSearch = useSettled(search.trim(), 300);
  const query = useRequesterQuery({
    endpoint: getOrdersBoardEndpoint,
    options: { query: { ...(mode ? { mode } : {}), ...(settledSearch.length >= 2 ? { search: settledSearch } : {}) } },
    // Keep the old columns on screen while a new search or filter loads, instead of flashing the whole board empty.
    queryOptions: { refetchInterval: REFRESH_MS, placeholderData: keepPreviousData },
  });

  return (
    <PageShell
      title="Orders board"
      description="Everything that needs a hand, oldest first. Tap the button on a card to move it to its next step."
      maxWidth="full"
      actions={
        <Link href={AppRoute.ORDERS} className={LINK_BUTTON}>
          <List aria-hidden="true" className="size-4" />
          Order list
        </Link>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <CustomInput label="Search" placeholder="Order number, name or phone" value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" />
        </div>
        <div role="group" aria-label="Fulfilment" className="flex border border-[var(--st-line-strong)]">
          {MODES.map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={mode === option.value}
              onClick={() => setMode(option.value)}
              className="min-h-[var(--st-tap-min)] min-w-20 px-4 font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--st-focus)] aria-pressed:bg-[var(--st-accent)] aria-pressed:text-[var(--st-surface)]"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <QueryState query={query} entityName="orders board" backRoute={{ path: AppRoute.ORDERS, label: "Orders" }}>
        {(board) => <BoardColumns columns={board.columns} onChanged={() => void query.refetch()} />}
      </QueryState>
    </PageShell>
  );
}

function BoardColumns({ columns, onChanged }: { columns: BoardColumn[]; onChanged: () => void }) {
  const [announcement, setAnnouncement] = useState("");
  const empty = columns.every((column) => column.total === 0);
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {empty ? <p className="border border-[var(--st-line)] bg-[var(--st-surface)] p-6 text-[var(--st-ink-muted)]">Nothing to do right now — no orders match.</p> : null}
      {/* The columns scroll sideways inside this region; the page itself never does. */}
      <div role="region" aria-label="Orders by status" tabIndex={0} className="flex gap-4 overflow-x-auto pb-4 focus-visible:outline-2 focus-visible:outline-[var(--st-focus)]">
        {columns.map((column) => (
          <Column key={column.status} column={column} onChanged={onChanged} announce={setAnnouncement} />
        ))}
      </div>
    </>
  );
}

function Column({ column, onChanged, announce }: { column: BoardColumn; onChanged: () => void; announce: (message: string) => void }) {
  const spec = ORDER_STATUS[column.status];
  const hidden = column.total - column.orders.length;
  return (
    <section aria-labelledby={`col-${column.status}`} className="flex w-[300px] shrink-0 flex-col gap-3">
      <header className="relative flex items-center justify-between border border-[var(--st-line)] bg-[var(--st-surface)] px-4 py-3">
        <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[var(--st-rail)]" style={{ background: TONE_VAR[spec.tone] }} />
        <h2 id={`col-${column.status}`} className="font-semibold">
          {spec.label}
        </h2>
        <span className="st-figure rounded-sm bg-[var(--st-canvas)] px-2 py-0.5 font-semibold" aria-label={`${column.total} orders`}>
          {column.total}
        </span>
      </header>
      <ul className="flex flex-col gap-3">
        {column.orders.map((card) => (
          <li key={card._id}>
            <Card card={card} onChanged={onChanged} announce={announce} />
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <Link href={`${AppRoute.ORDERS}?status=${column.status}`} className="text-center font-medium text-[var(--st-accent)] underline underline-offset-2">
          {hidden} more in the order list
        </Link>
      ) : null}
    </section>
  );
}

function Card({ card, onChanged, announce }: { card: BoardCard; onChanged: () => void; announce: (message: string) => void }) {
  const can = usePermission();
  const format = useStoreFormat();
  const keys = useActionKeys();
  const [pending, setPending] = useState<OrderStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Keep "12 min" honest between refreshes.
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const steps = can(CustomPermission.ORDER_TRANSITION) ? advanceStepsFor(card) : [];
  const overdue = isOverdue(card.placedAt, now);
  const ModeIcon = card.mode === "DELIVERY" ? Truck : Store;

  async function advance(to: Exclude<OrderStatus, "PLACED">) {
    setPending(to);
    const scope = `board:${card._id}:${to}`;
    const ok = await runAction(() => requester(transitionOrderEndpoint, { params: { id: card._id }, body: { status: to }, headers: keys.headers(scope) }), `Order ${card.orderNumber}: ${ORDER_STATUS[to].label.toLowerCase()}`);
    setPending(null);
    if (ok) {
      keys.release(scope);
      announce(`Order ${card.orderNumber} is now ${ORDER_STATUS[to].label}.`);
      onChanged();
    }
  }

  return (
    <article className="flex flex-col gap-3 border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
      <div className="flex items-start justify-between gap-2">
        <Link href={AppRoute.ORDER(card._id)} className="st-figure text-[18px] font-semibold text-[var(--st-ink)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--st-focus)]">
          {card.orderNumber}
        </Link>
        <span className="st-figure whitespace-nowrap font-semibold">{format.money(card.total)}</span>
      </div>
      <p dir="auto" className="truncate font-medium">
        {card.customerName ?? "Guest"}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-[var(--st-ink-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <ModeIcon aria-hidden="true" className="size-4" />
          {card.mode === "DELIVERY" ? `Delivery${card.zone ? ` · ${card.zone}` : ""}` : "Pickup"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Package aria-hidden="true" className="size-4" />
          <span className="st-figure">{card.itemCount}</span> {card.itemCount === 1 ? "line" : "lines"}
        </span>
        <span className="inline-flex items-center gap-1.5" style={overdue ? { color: "var(--st-status-danger)", fontWeight: 600 } : undefined}>
          <Clock aria-hidden="true" className="size-4" />
          <span className="sr-only">Waiting </span>
          <span className="st-figure">{waitingLabel(card.placedAt, now)}</span>
          {overdue ? <span className="sr-only"> — overdue</span> : null}
        </span>
      </p>
      {/* Two separate signals: where the order is, and whether it is paid. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <OrderStatusSignal status={card.status} />
        <PaymentStatusSignal status={card.paymentStatus} />
      </div>
      {steps.length > 0 ? (
        <div className="flex flex-col gap-2">
          {steps.map(({ to, blocked }, index) => (
            <button
              key={to}
              type="button"
              disabled={pending !== null}
              aria-disabled={blocked || undefined}
              aria-describedby={blocked ? `blocked-${card._id}` : undefined}
              onClick={blocked ? undefined : () => advance(to)}
              className={
                "min-h-12 w-full px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--st-focus)] " +
                (index === 0 ? "bg-[var(--st-accent)] text-[var(--st-surface)] hover:bg-[var(--st-accent-hover)] " : "border border-[var(--st-line-strong)] bg-[var(--st-surface)] hover:bg-[var(--st-accent-soft)] ") +
                (blocked ? "cursor-not-allowed opacity-50 " : "") +
                (pending === to ? "opacity-70" : "")
              }
            >
              {pending === to ? "Saving…" : ADVANCE_LABEL[to]}
            </button>
          ))}
          {steps.some((step) => step.blocked) ? (
            <p id={`blocked-${card._id}`} className="text-[13px] text-[var(--st-status-pending)]">
              Verify the payment first.
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
