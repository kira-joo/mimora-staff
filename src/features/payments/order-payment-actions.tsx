"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { DialogBody, useConfirm, useDialog, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomInput, CustomTextarea } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { useState } from "react";
import type { OrderDetail } from "src/api/orders.endpoints";
import { refundPaymentEndpoint, rejectPaymentEndpoint, verifyPaymentEndpoint } from "src/api/payments.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { useActionKeys } from "src/common/feedback/idempotency-key";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { usePermission } from "src/features/auth/use-permission";
import { canTransitionPayment } from "src/server/engines/order-state/order-state-machine";
import { refundFormErrors } from "./refund-form";

/** The decimal shape RefundPaymentDto accepts; whether the amount fits is the server's decision. */

/**
 * The payment axis's own actions on an order — separate from its
 * fulfilment actions. Which steps exist comes from the payment state
 * machine (`canTransitionPayment`), the same one the API enforces with;
 * each step also needs its own permission. A refund records money already
 * returned outside the system (D-12): its amount AND its reference (the
 * transfer or receipt number) are required — no pretence of automation — and
 * the server refuses an amount above what remains refundable on the order.
 *
 * Verify, reject and refund each carry an Idempotency-Key: one per user
 * action, reused if that same action is retried (see `useActionKeys`).
 */
export function OrderPaymentActions({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const can = usePermission();
  const format = useStoreFormat();
  const { confirm } = useConfirm();
  const { openDialog } = useDialog();
  const [pending, setPending] = useState<string | null>(null);
  const keys = useActionKeys();
  const status = order.payment.status;

  const canVerify = canTransitionPayment(status, "VERIFIED") && can(CustomPermission.PAYMENT_VERIFY);
  const canReject = canTransitionPayment(status, "REJECTED") && can(CustomPermission.PAYMENT_REJECT);
  const canRefund = canTransitionPayment(status, "REFUNDED") && can(CustomPermission.PAYMENT_REFUND);
  if (!canVerify && !canReject && !canRefund) return null;

  async function run(key: string, fingerprint: unknown, call: (headers: Record<string, string>) => Promise<unknown>, success: string) {
    setPending(key);
    const scope = `${key}:${order._id}:${JSON.stringify(fingerprint)}`;
    const ok = await runAction(() => call(keys.headers(scope)), success);
    setPending(null);
    if (ok) {
      keys.release(scope);
      onChanged();
    }
  }

  async function verify() {
    const ok = await confirm({
      title: `Verify payment for ${order.orderNumber}?`,
      description: `Confirms ${format.money(order.total)} was received.`,
      confirmLabel: "Verify payment",
    });
    if (ok) await run("verify", null, (headers) => requester(verifyPaymentEndpoint, { params: { id: order._id }, headers }), "Payment verified");
  }

  async function reject() {
    const outcome = await openDialog<typeof RejectPaymentDialog, string>({ component: RejectPaymentDialog, props: {} }).result;
    if (outcome.status === "resolved") {
      await run("reject", outcome.value, (headers) => requester(rejectPaymentEndpoint, { params: { id: order._id }, body: { reason: outcome.value }, headers }), "Payment rejected");
    }
  }

  async function refund() {
    const outcome = await openDialog<typeof RefundPaymentDialog, RefundValues>({
      component: RefundPaymentDialog,
      props: { orderNumber: order.orderNumber, total: format.money(order.total) },
    }).result;
    if (outcome.status === "resolved") {
      await run("refund", outcome.value, (headers) => requester(refundPaymentEndpoint, { params: { id: order._id }, body: outcome.value, headers }), "Refund recorded");
    }
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--st-line)] pt-4">
      {canVerify ? (
        <CustomButton size="sm" onClick={verify} loading={pending === "verify"} disabled={pending !== null}>
          Verify payment
        </CustomButton>
      ) : null}
      {canReject ? (
        <CustomButton size="sm" variant="outline" className="text-[var(--st-status-danger)]" onClick={reject} loading={pending === "reject"} disabled={pending !== null}>
          Reject payment
        </CustomButton>
      ) : null}
      {canRefund ? (
        <CustomButton size="sm" variant="outline" onClick={refund} loading={pending === "refund"} disabled={pending !== null}>
          Record refund
        </CustomButton>
      ) : null}
    </div>
  );
}

function RejectPaymentDialog({ titleId, descriptionId, resolve, dismiss }: DialogContentProps<string>) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title="Reject this payment?"
      description="The customer sees the reason and can submit a new proof."
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss}>
            Keep it
          </CustomButton>
          <CustomButton variant="destructive" onClick={() => (reason.trim() ? resolve(reason.trim()) : setError("Give a reason — the customer sees it."))}>
            Reject payment
          </CustomButton>
        </>
      }
    >
      <CustomTextarea label="Reason" required rows={3} maxLength={500} dir="auto" value={reason} error={error} onChange={(e) => (setReason(e.target.value), setError(undefined))} />
    </DialogBody>
  );
}

interface RefundValues {
  amount: string;
  reference: string;
  reason?: string;
}

function RefundPaymentDialog({ orderNumber, total, titleId, descriptionId, resolve, dismiss }: DialogContentProps<RefundValues> & { orderNumber: string; total: string }) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; reference?: string }>({});

  function submit() {
    const next = refundFormErrors({ amount, reference });
    setErrors(next);
    if (next.amount || next.reference) return;
    resolve({ amount: amount.trim(), reference: reference.trim(), reason: reason.trim() || undefined });
  }

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={`Record a refund on ${orderNumber}`}
      description={`Record money already returned to the customer. The order total is ${total}; the server refuses an amount above what remains refundable.`}
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss}>
            Cancel
          </CustomButton>
          <CustomButton onClick={submit}>Record refund</CustomButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <CustomInput label="Amount" required inputMode="decimal" className="st-figure" value={amount} error={errors.amount} onChange={(e) => (setAmount(e.target.value), setErrors((current) => ({ ...current, amount: undefined })))} />
        <CustomInput
          label="Reference"
          required
          description="The transfer or receipt number proving the money moved — recorded on the audit trail."
          dir="auto"
          value={reference}
          maxLength={200}
          error={errors.reference}
          onChange={(e) => (setReference(e.target.value), setErrors((current) => ({ ...current, reference: undefined })))}
        />
        <CustomTextarea label="Reason" rows={2} maxLength={500} dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </DialogBody>
  );
}
