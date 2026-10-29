"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { updateOrderTrackingEndpoint, type OrderDetail } from "src/api/orders.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { useActionKeys } from "src/common/feedback/idempotency-key";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { usePermission } from "src/features/auth/use-permission";
import { EditTrackingDialog } from "./tracking-dialogs";

/** The statuses from which a delivery order has a tracking number to show or to add (mirrors the server's `updateOrderTracking`). */
const TRACKABLE = ["SHIPPED", "IN_TRANSIT", "DELIVERED"] as const;

/** Only an https link is ever rendered as one; the server validates the template, and this is the second lock. */
const isSafeLink = (url: string) => url.startsWith("https://");

/**
 * Carrier and tracking number, as entered by staff. The link is the one the customer sees — a snapshot taken when it
 * was entered. Staff holding Order.transition can add or correct it; every change lands on the timeline.
 */
export function TrackingPanel({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const can = usePermission();
  const format = useStoreFormat();
  const { openDialog } = useDialog();
  const keys = useActionKeys();
  const [saving, setSaving] = useState(false);

  if (order.fulfilment.mode !== "DELIVERY" || !(TRACKABLE as readonly string[]).includes(order.status)) return null;
  const tracking = order.tracking;

  async function edit() {
    const handle = openDialog<typeof EditTrackingDialog, { carrierKey: string; trackingNumber: string }>({
      component: EditTrackingDialog,
      props: { orderNumber: order.orderNumber, carriers: order.carriers ?? [], initial: tracking ? { carrierKey: tracking.carrierKey, trackingNumber: tracking.trackingNumber } : undefined },
    });
    const outcome = await handle.result;
    if (outcome.status !== "resolved") return;
    setSaving(true);
    const scope = `tracking:${order._id}:${outcome.value.carrierKey}:${outcome.value.trackingNumber}`;
    const ok = await runAction(
      () => requester(updateOrderTrackingEndpoint, { params: { id: order._id }, body: outcome.value, headers: keys.headers(scope) }),
      `Tracking saved for ${order.orderNumber}`
    );
    setSaving(false);
    if (ok) {
      keys.release(scope);
      onChanged();
    }
  }

  return (
    <section className="min-w-0 border border-[var(--st-line)] bg-[var(--st-surface)] p-5">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--st-ink-muted)]">Tracking</h2>
      {tracking ? (
        <dl className="flex flex-col gap-2">
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
            <dt className="text-[var(--st-ink-muted)]">Carrier</dt>
            <dd dir="auto">{tracking.carrierName}</dd>
          </div>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
            <dt className="text-[var(--st-ink-muted)]">Number</dt>
            <dd className="min-w-0 break-words">
              {isSafeLink(tracking.url) ? (
                <a href={tracking.url} target="_blank" rel="noopener noreferrer" className="st-figure inline-flex items-center gap-1.5 text-[var(--st-accent)] underline underline-offset-2">
                  <bdi dir="ltr">{tracking.trackingNumber}</bdi>
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                  <span className="sr-only">(opens the carrier&apos;s tracking page)</span>
                </a>
              ) : (
                <bdi dir="ltr" className="st-figure">
                  {tracking.trackingNumber}
                </bdi>
              )}
            </dd>
          </div>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
            <dt className="text-[var(--st-ink-muted)]">Entered</dt>
            <dd className="text-[13px] text-[var(--st-ink-muted)]">
              {format.dateTime(tracking.updatedAt)}
              {tracking.updatedByName ? <> · <span dir="auto">{tracking.updatedByName}</span></> : null}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-[var(--st-ink-muted)]">No tracking recorded.</p>
      )}
      {can(CustomPermission.ORDER_TRANSITION) ? (
        <div className="mt-3">
          <CustomButton variant="outline" onClick={edit} loading={saving}>
            {tracking ? "Correct tracking" : "Add tracking"}
          </CustomButton>
        </div>
      ) : null}
    </section>
  );
}
