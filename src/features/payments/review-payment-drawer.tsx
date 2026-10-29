"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useActionKeys } from "src/common/feedback/idempotency-key";
import { runAction } from "src/common/feedback/run-action";
import { DialogBody, useConfirm, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomTextarea } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, ImageOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { rejectPaymentEndpoint, verifyPaymentEndpoint, type PaymentQueueItem } from "src/api/payments.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { paymentMethodLabel, TONE_VAR } from "src/features/status/status-vocabulary";
import { ageOf } from "./payment-ageing";

export type ReviewOutcome = "verified" | "rejected";

/**
 * The review of one transfer, beside the queue (a drawer, so the queue stays
 * in view): what the customer was asked to pay and where, the proof they
 * sent, and the two decisions. Verify is confirmed; reject needs a reason,
 * which the customer and the order timeline both see. Each decision shows
 * only to a role holding its permission — the API checks again.
 */
export function ReviewPaymentDrawer({ item, titleId, descriptionId, resolve, dismiss, setBusy }: DialogContentProps<ReviewOutcome> & { item: PaymentQueueItem }) {
  const format = useStoreFormat();
  const can = usePermission();
  const { confirm } = useConfirm();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [pending, setPending] = useState<ReviewOutcome | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const keys = useActionKeys();
  const amount = format.money(item.expectedAmount);

  /** Every decision carries an Idempotency-Key — one per action, reused if the same decision is retried. */
  async function run(outcome: ReviewOutcome, fingerprint: unknown, call: (headers: Record<string, string>) => Promise<unknown>) {
    setPending(outcome);
    setBusy(true);
    const scope = `${outcome}:${item.orderId}:${JSON.stringify(fingerprint)}`;
    const ok = await runAction(() => call(keys.headers(scope)), outcome === "verified" ? `Payment for ${item.orderNumber} verified` : `Payment for ${item.orderNumber} rejected`);
    setPending(null);
    setBusy(false);
    // A refusal (e.g. someone else already decided it) keeps the review open with the server's message shown.
    if (ok) {
      keys.release(scope);
      resolve(outcome);
    }
  }

  async function verify() {
    const ok = await confirm({
      title: `Verify ${amount}?`,
      description: `Confirms the money for ${item.orderNumber} arrived. Only verify once you have seen it in the account.`,
      confirmLabel: "Verify payment",
    });
    if (ok) await run("verified", null, (headers) => requester(verifyPaymentEndpoint, { params: { id: item.orderId }, headers }));
  }

  async function reject() {
    if (!reason.trim()) {
      setReasonError("Give a reason — the customer sees it.");
      return;
    }
    await run("rejected", reason.trim(), (headers) => requester(rejectPaymentEndpoint, { params: { id: item.orderId }, body: { reason: reason.trim() }, headers }));
  }

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={<span className="st-figure">{item.orderNumber}</span>}
      description={`${paymentMethodLabel(item.method)} · placed ${format.dateTime(item.placedAt)}`}
      actions={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <CustomButton variant="outline" onClick={dismiss} disabled={pending !== null}>
            Close
          </CustomButton>
          {can(CustomPermission.PAYMENT_REJECT) ? (
            rejecting ? (
              <CustomButton variant="destructive" onClick={reject} loading={pending === "rejected"} disabled={pending !== null}>
                Reject payment
              </CustomButton>
            ) : (
              <CustomButton variant="outline" className="text-[var(--st-status-danger)]" onClick={() => setRejecting(true)} disabled={pending !== null}>
                Reject…
              </CustomButton>
            )
          ) : null}
          {can(CustomPermission.PAYMENT_VERIFY) && !rejecting ? (
            <CustomButton onClick={verify} loading={pending === "verified"} disabled={pending !== null}>
              Verify payment
            </CustomButton>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt className="text-[var(--st-ink-muted)]">Expected</dt>
          <dd className="st-figure text-[16px] font-semibold">{amount}</dd>
          {item.destinationSnapshot?.accountName ? (
            <>
              <dt className="text-[var(--st-ink-muted)]">Paid to</dt>
              <dd dir="auto">{item.destinationSnapshot.accountName}</dd>
            </>
          ) : null}
          {item.destinationSnapshot?.number || item.destinationSnapshot?.handle ? (
            <>
              <dt className="text-[var(--st-ink-muted)]">Account</dt>
              <dd>
                <bdi dir="ltr" className="st-figure">
                  {item.destinationSnapshot.number ?? item.destinationSnapshot.handle}
                </bdi>
              </dd>
            </>
          ) : null}
          {item.proof ? (
            <>
              <dt className="text-[var(--st-ink-muted)]">Waiting</dt>
              <dd style={{ color: TONE_VAR[ageOf(item.proof.submittedAt, new Date()).tone] }} className="font-medium">
                {ageOf(item.proof.submittedAt, new Date()).label} since the proof arrived
                {item.overdue ? (
                  <span className="block text-[13px]" style={{ color: TONE_VAR.danger }}>
                    Overdue — past this method&apos;s {item.verificationWindowMinutes}-minute verification window
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>

        <section aria-label="Payment proof">
          {item.proof && !previewFailed ? (
            <a href={item.proof.signedUrl} target="_blank" rel="noopener noreferrer" className="group block border border-[var(--st-line)] bg-[var(--st-canvas)]">
              {/* A signed, expiring URL from the backend — an <img>, not next/image, so nothing caches it past its expiry. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.proof.signedUrl} alt={`Payment proof for ${item.orderNumber}`} className="mx-auto max-h-[52vh] w-auto object-contain" onError={() => setPreviewFailed(true)} />
              <span className="flex items-center gap-1.5 border-t border-[var(--st-line)] px-3 py-2 text-[13px] text-[var(--st-accent)]">
                <ExternalLink aria-hidden="true" className="size-3.5" /> Open full size
              </span>
            </a>
          ) : (
            <div className="flex flex-col items-center gap-2 border border-dashed border-[var(--st-line-strong)] px-4 py-8 text-center text-[var(--st-ink-muted)]">
              <ImageOff aria-hidden="true" className="size-5" />
              {item.proof ? (
                <>
                  <p>The preview couldn&apos;t load.</p>
                  <a href={item.proof.signedUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--st-accent)] underline">
                    Open the proof
                  </a>
                  <p className="text-[13px]">The link expires five minutes after the queue loaded — reopen this review for a fresh one.</p>
                </>
              ) : (
                <p>No proof was uploaded for this payment.</p>
              )}
            </div>
          )}
        </section>

        <AnimatePresence initial={false}>
          {rejecting ? (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }} className="overflow-hidden">
              <CustomTextarea
                label="Why is it rejected?"
                description="The customer sees this, and it is recorded on the order's timeline."
                required
                rows={3}
                maxLength={500}
                dir="auto"
                autoFocus
                value={reason}
                error={reasonError}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (reasonError) setReasonError(undefined);
                }}
              />
              <button type="button" className="mt-2 text-[13px] text-[var(--st-ink-muted)] underline" onClick={() => setRejecting(false)}>
                Don&apos;t reject
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <Link href={AppRoute.ORDER(item.orderId)} className="text-[13px] font-medium text-[var(--st-accent)] underline underline-offset-2">
          Open the order
        </Link>
      </div>
    </DialogBody>
  );
}
