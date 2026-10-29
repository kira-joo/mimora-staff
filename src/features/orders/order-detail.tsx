"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState, Timeline } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { ReactNode } from "react";
import { getOrderEndpoint, type OrderDetail } from "src/api/orders.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { OrderStatusSignal, PaymentStatusSignal } from "src/features/status/status-signal";
import { ORDER_STATUS, TONE_VAR, paymentMethodLabel } from "src/features/status/status-vocabulary";
import { OrderActions } from "./order-actions";
import { OrderDocuments } from "./order-documents";
import { TrackingPanel } from "./tracking-panel";
import { OrderPaymentActions } from "src/features/payments/order-payment-actions";
import { PaymentProofs } from "src/features/payments/payment-proofs";
import { timelineActorLabel, timelineEventLabel } from "./timeline-labels";

/**
 * An order's full record (MDS §6.3) — everything here is the order's own
 * snapshot, never re-read from today's catalog. Order and payment status are
 * two signals side by side.
 */
export function OrderDetailView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getOrderEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="order" backRoute={{ path: AppRoute.ORDERS, label: "Orders" }}>
      {(order) => <OrderRecord order={order} onChanged={() => query.refetch()} />}
    </QueryState>
  );
}

function OrderRecord({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const format = useStoreFormat();
  const tone = TONE_VAR[ORDER_STATUS[order.status]?.tone ?? "neutral"];

  return (
    <PageShell
      title={<span className="st-figure text-[20px] font-semibold">{order.orderNumber}</span>}
      description={`Placed ${format.dateTime(order.placedAt)} · ${order.fulfilment.mode === "DELIVERY" ? "Delivery" : "Pickup"}`}
      backRoute={{ path: AppRoute.ORDERS, label: "Orders" }}
      actions={<OrderActions order={order} onChanged={onChanged} />}
    >
      <div className="mb-5">
        <OrderDocuments order={order} />
      </div>

      <div className="relative mb-5 flex flex-wrap gap-x-8 gap-y-2 border border-[var(--st-line)] bg-[var(--st-surface)] px-5 py-3.5">
        <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[var(--st-rail)]" style={{ background: tone }} />
        <Field label="Order status">
          <OrderStatusSignal status={order.status} />
        </Field>
        <Field label="Payment">
          <PaymentStatusSignal status={order.payment.status} />
        </Field>
        <Field label="Method">{paymentMethodLabel(order.payment.method)}</Field>
        <Field label="Total">
          <span className="st-figure font-semibold">{format.money(order.total)}</span>
        </Field>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title={`Items (${order.lines.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-start">
                <thead>
                  <tr className="border-b border-[var(--st-line)] text-[13px] text-[var(--st-ink-muted)]">
                    <th className="py-2 pe-3 text-start font-medium">Item</th>
                    <th className="py-2 pe-3 text-start font-medium">SKU</th>
                    <th className="py-2 pe-3 text-end font-medium">Qty</th>
                    <th className="py-2 pe-3 text-end font-medium">Unit</th>
                    <th className="py-2 text-end font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.lineNumber} className="border-b border-[var(--st-line)] last:border-0">
                      <td className="py-2.5 pe-3">
                        <span dir="auto" className="block font-medium">
                          {line.productName}
                        </span>
                        {line.variantDescription ? (
                          <span dir="auto" className="block text-[13px] text-[var(--st-ink-muted)]">
                            {line.variantDescription}
                          </span>
                        ) : null}
                      </td>
                      <td className="st-figure whitespace-nowrap py-2.5 pe-3">{line.sku}</td>
                      <td className="st-figure py-2.5 pe-3 text-end">{line.quantity}</td>
                      <td className="st-figure py-2.5 pe-3 text-end">{format.money(line.unitPrice)}</td>
                      <td className="st-figure py-2.5 text-end">{format.money(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ms-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[var(--st-ink-muted)]">
              <dt>Subtotal</dt>
              <dd className="st-figure text-end text-[var(--st-ink)]">{format.money(order.subtotal)}</dd>
              {Number(order.discount) > 0 ? (
                <>
                  <dt>Discount</dt>
                  <dd className="st-figure text-end text-[var(--st-ink)]">−{format.money(order.discount)}</dd>
                </>
              ) : null}
              <dt>Shipping</dt>
              <dd className="st-figure text-end text-[var(--st-ink)]">{format.money(order.fulfilment.fee)}</dd>
              <dt>Tax</dt>
              <dd className="st-figure text-end text-[var(--st-ink)]">{format.money(order.tax)}</dd>
              <dt className="border-t border-[var(--st-line)] pt-1.5 font-semibold text-[var(--st-ink)]">Total</dt>
              <dd className="st-figure border-t border-[var(--st-line)] pt-1.5 text-end font-semibold text-[var(--st-ink)]">{format.money(order.total)}</dd>
            </dl>
          </Panel>

          <Panel title="Timeline">
            <Timeline
              items={[...order.timeline].reverse().map((entry, index) => ({
                id: `${entry.type}-${entry.at}-${index}`,
                content: (
                  <div>
                    <p className="font-medium">{timelineEventLabel(entry.type)}</p>
                    <p className="text-[13px] text-[var(--st-ink-muted)]">
                      {format.dateTime(entry.at)} · <span dir="auto">{timelineActorLabel(entry)}</span>
                    </p>
                    {entry.reason ? (
                      <p dir="auto" className="mt-1 text-[13px]">
                        “{entry.reason}”
                      </p>
                    ) : null}
                  </div>
                ),
              }))}
              emptyState={<p className="text-[var(--st-ink-muted)]">No events recorded.</p>}
            />
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Customer">
            <dl className="flex flex-col gap-2">
              <Row label="Name">
                <span dir="auto">{order.guestName ?? (order.customerId ? "Registered customer" : "—")}</span>
              </Row>
              <Row label="Phone">
                <bdi dir="ltr" className="st-figure">
                  {order.guestPhone ?? "—"}
                </bdi>
              </Row>
              <Row label="Email">{order.guestEmail ?? "—"}</Row>
              <Row label="Terms accepted">
                {order.termsVersionAccepted ? (
                  <>
                    <span className="st-figure">Version {order.termsVersionAccepted}</span>
                    {order.acceptedAt ? <span className="text-[var(--st-ink-muted)]"> · {format.dateTime(order.acceptedAt)}</span> : null}
                  </>
                ) : (
                  <span className="text-[var(--st-ink-muted)]">Not recorded</span>
                )}
              </Row>
            </dl>
          </Panel>
          <Panel title="Fulfilment">
            <dl className="flex flex-col gap-2">
              <Row label="Mode">{order.fulfilment.mode === "DELIVERY" ? "Delivery" : "Pickup"}</Row>
              {order.fulfilment.zone ? <Row label="Zone">{order.fulfilment.zone}</Row> : null}
              {order.fulfilment.addressSnapshot ? (
                <Row label="Deliver to">
                  <address dir="auto" className="not-italic">
                    {order.fulfilment.addressSnapshot.recipientName}
                    <br />
                    {order.fulfilment.addressSnapshot.addressLine1}
                    {order.fulfilment.addressSnapshot.addressLine2 ? `, ${order.fulfilment.addressSnapshot.addressLine2}` : ""}
                    <br />
                    {order.fulfilment.addressSnapshot.city}, {order.fulfilment.addressSnapshot.governorate}
                    <br />
                    {/* A phone number is left-to-right even inside Arabic: isolated, or its digits read mirrored. */}
                    <bdi dir="ltr" className="st-figure">
                      {order.fulfilment.addressSnapshot.phone}
                    </bdi>
                  </address>
                </Row>
              ) : null}
              {order.fulfilment.pickupLocationSnapshot ? (
                <Row label="Pickup at">
                  <span dir="auto">{order.fulfilment.pickupLocationSnapshot.name}</span>
                </Row>
              ) : null}
              <Row label="Dispatch by">{format.dateTime(order.fulfilment.dispatchBy)}</Row>
            </dl>
          </Panel>
          <TrackingPanel order={order} onChanged={onChanged} />
          <Panel title="Payment">
            <dl className="flex flex-col gap-2">
              <Row label="Method">{paymentMethodLabel(order.payment.method)}</Row>
              {order.payment.destinationSnapshot?.accountName ? (
                <Row label="Paid to">
                  <span dir="auto">{order.payment.destinationSnapshot.accountName}</span>
                </Row>
              ) : null}
              <Row label="Status">
                <PaymentStatusSignal status={order.payment.status} />
              </Row>
              {/* Payment and return refunds together — the order's own running total, never summed here. */}
              {!/^0+(\.0+)?$/.test(order.refundedTotal) ? (
                <Row label="Refunded">
                  {format.money(order.refundedTotal)} of {format.money(order.total)}
                </Row>
              ) : null}
            </dl>
            <OrderPaymentActions order={order} onChanged={onChanged} />
          </Panel>
          {order.paymentProofs && order.paymentProofs.length > 0 ? (
            <Panel title="Payment proof">
              <PaymentProofs orderNumber={order.orderNumber} proofs={order.paymentProofs} />
            </Panel>
          ) : null}
          {order.notes ? (
            // The customer's own note from checkout. Staff never write to it — their reasons are on the timeline —
            // so the panel says whose words these are.
            <Panel title="Customer note">
              <p dir="auto" className="whitespace-pre-line">
                {order.notes}
              </p>
            </Panel>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border border-[var(--st-line)] bg-[var(--st-surface)] p-5">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--st-ink-muted)]">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[13px] text-[var(--st-ink-muted)]">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
      <dt className="text-[var(--st-ink-muted)]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
