"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useActionKeys } from "src/common/feedback/idempotency-key";
import { runAction } from "src/common/feedback/run-action";
import { DialogBody, useConfirm, useDialog, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomTextarea } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { usePermission } from "src/features/auth/use-permission";
import { useId, useState } from "react";
import { transitionOrderEndpoint, type OrderDetail, type OrderStatus } from "src/api/orders.endpoints";
import { ShipOrderDialog, type TrackingChoice } from "./tracking-dialogs";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { nextStatuses, paymentAllowsTransition } from "src/server/engines/order-state/order-state-machine";
import { ORDER_STATUS } from "src/features/status/status-vocabulary";

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: "Confirm order",
  PROCESSING: "Start processing",
  READY_FOR_PICKUP: "Mark ready for pickup",
  SHIPPED: "Mark shipped",
  IN_TRANSIT: "Mark in transit",
  DELIVERED: "Mark delivered",
  COLLECTED: "Mark collected",
};

/**
 * The order's next steps. Which transitions to offer comes from the order
 * state machine itself (`nextStatuses`) — the same module the API enforces
 * with — so the UI never offers a step the server would refuse, and never
 * re-states the rules. Shown only to staff holding Order.transition; the API
 * checks that permission again.
 *
 * Consequential actions are confirmed, never optimistic: the status changes
 * on screen when the server says it changed.
 */
export function OrderActions({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const can = usePermission();
  const { confirm } = useConfirm();
  const { openDialog } = useDialog();
  const [pending, setPending] = useState<OrderStatus | null>(null);
  const keys = useActionKeys();
  const blockedId = useId();

  if (!can(CustomPermission.ORDER_TRANSITION)) return null;

  const options = nextStatuses(order.status, order.fulfilment.mode);
  if (options.length === 0) return null;

  // The server refuses these too (same engine rule); this only says why up front.
  const advanceOptions = options.filter((to): to is Exclude<OrderStatus, "PLACED" | "CANCELLED"> => to !== "CANCELLED" && to !== "PLACED");
  const paymentBlocked = advanceOptions.some((to) => !paymentAllowsTransition(to, order.payment.status));

  async function transition(to: Exclude<OrderStatus, "PLACED">, reason?: string, tracking?: TrackingChoice) {
    setPending(to);
    // A transition can release stock or change payment state, so it carries an Idempotency-Key: one per action, reused on retry.
    const scope = `transition:${order._id}:${to}:${reason ?? ""}:${tracking?.carrierKey ?? ""}:${tracking?.trackingNumber ?? ""}`;
    const ok = await runAction(
      () => requester(transitionOrderEndpoint, { params: { id: order._id }, body: { status: to, reason, ...tracking }, headers: keys.headers(scope) }),
      `Order ${order.orderNumber}: ${ORDER_STATUS[to].label.toLowerCase()}`
    );
    setPending(null);
    if (ok) {
      keys.release(scope);
      onChanged();
    }
  }

  async function advance(to: Exclude<OrderStatus, "PLACED">) {
    // Handing the parcel to a courier is where a carrier and tracking number are known: ask for them (optionally) instead of a bare confirm.
    if (to === "SHIPPED") {
      const handle = openDialog<typeof ShipOrderDialog, TrackingChoice>({ component: ShipOrderDialog, props: { orderNumber: order.orderNumber, carriers: order.carriers ?? [] } });
      const outcome = await handle.result;
      if (outcome.status === "resolved") await transition("SHIPPED", undefined, outcome.value);
      return;
    }
    const ok = await confirm({
      title: `${ACTION_LABEL[to]}?`,
      description: `Order ${order.orderNumber} moves from ${ORDER_STATUS[order.status].label} to ${ORDER_STATUS[to].label}.`,
      confirmLabel: ACTION_LABEL[to],
    });
    if (ok) await transition(to);
  }

  async function cancel() {
    const handle = openDialog<typeof CancelOrderDialog, string>({ component: CancelOrderDialog, props: { orderNumber: order.orderNumber } });
    const outcome = await handle.result;
    if (outcome.status === "resolved") await transition("CANCELLED", outcome.value);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {advanceOptions.map((to) => {
          const blocked = !paymentAllowsTransition(to, order.payment.status);
          return (
            <CustomButton
              key={to}
              onClick={blocked ? undefined : () => advance(to)}
              loading={pending === to}
              disabled={pending !== null}
              aria-disabled={blocked || undefined}
              aria-describedby={blocked ? blockedId : undefined}
              className={blocked ? "cursor-not-allowed opacity-50" : undefined}
            >
              {ACTION_LABEL[to]}
            </CustomButton>
          );
        })}
        {options.includes("CANCELLED") ? (
          <CustomButton variant="outline" onClick={cancel} loading={pending === "CANCELLED"} disabled={pending !== null} className="text-[var(--st-status-danger)]">
            Cancel order
          </CustomButton>
        ) : null}
      </div>
      {paymentBlocked ? (
        <p id={blockedId} className="text-sm text-[var(--st-status-pending)]">
          Payment has not been verified — verify the receipt before shipping or handing over this order.
        </p>
      ) : null}
    </div>
  );
}

/** Cancelling needs a reason (the state machine requires one); it is shown on the order's timeline. */
function CancelOrderDialog({ orderNumber, titleId, descriptionId, resolve, dismiss }: DialogContentProps<string> & { orderNumber: string }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={`Cancel order ${orderNumber}?`}
      description="Stock it reserved is released. This can't be undone."
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss}>
            Keep order
          </CustomButton>
          <CustomButton
            variant="destructive"
            onClick={() => {
              if (!reason.trim()) {
                setError("Give a reason — it appears on the order's timeline.");
                return;
              }
              resolve(reason.trim());
            }}
          >
            Cancel order
          </CustomButton>
        </>
      }
    >
      <CustomTextarea label="Reason" required rows={3} maxLength={500} value={reason} error={error} onChange={(event) => {
          setReason(event.target.value);
          if (error) setError(undefined);
        }} dir="auto" />
    </DialogBody>
  );
}
