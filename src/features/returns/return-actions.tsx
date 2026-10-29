"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { DialogBody, useConfirm, useDialog, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomInput, CustomTextarea } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { CustomSelect } from "@kira-joo/frontend-toolkit-tailwind/select";
import { useState } from "react";
import {
  approveReturnEndpoint,
  receiveReturnEndpoint,
  refundReturnEndpoint,
  rejectReturnEndpoint,
  type ReturnDetail,
  type ReturnDisposition,
  type ReturnLine,
} from "src/api/returns.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { useActionKeys } from "src/common/feedback/idempotency-key";
import { runAction } from "src/common/feedback/run-action";
import { usePermission } from "src/features/auth/use-permission";
import { canTransitionReturn } from "src/server/engines/returns/return-eligibility";
import { inspectedConditionErrors, receivableLines, refundAmountError } from "./return-helpers";

type ActionKey = "approve" | "reject" | "receive" | "refund";

/**
 * A return's next steps. Approve / reject / refund come from the backend's own
 * `canTransitionReturn` (the map the API's `assertReturnTransition` enforces),
 * so the UI never re-states the rules. Receive is offered only on an APPROVED
 * return, for lines that have no disposition yet; receiving the last line moves
 * the return to RECEIVED on the server. Refund is offered from RECEIVED (the
 * normal path) and, deliberately, from APPROVED too — it does not wait on the
 * goods (lost in transit, or the customer keeps the item) — which is simply
 * what the same map allows. The API re-checks all of it; a refusal (e.g.
 * over-refund, 409) surfaces as the error toast.
 *
 * Every money- or stock-moving call carries an Idempotency-Key, one per user
 * action and reused if that same action is retried, so a lost response never
 * becomes a second refund or a second restock.
 *
 * Nothing is optimistic: the screen changes when the server says it changed.
 */
export function ReturnActions({ ret, onChanged }: { ret: ReturnDetail; onChanged: () => void }) {
  const can = usePermission();
  const { confirm } = useConfirm();
  const { openDialog } = useDialog();
  const [pending, setPending] = useState<ActionKey | null>(null);
  const keys = useActionKeys();

  const canDecide = can(CustomPermission.RETURN_APPROVE);
  const offerApprove = canDecide && canTransitionReturn(ret.status, "APPROVED");
  const offerReject = canDecide && canTransitionReturn(ret.status, "REJECTED");
  const toReceive = receivableLines(ret.lines);
  const offerReceive = can(CustomPermission.RETURN_RECEIVE) && ret.status === "APPROVED" && toReceive.length > 0;
  const offerRefund = can(CustomPermission.PAYMENT_REFUND) && canTransitionReturn(ret.status, "REFUNDED");

  if (!offerApprove && !offerReject && !offerReceive && !offerRefund) return null;

  /** `fingerprint` is the action's payload: the same payload retried reuses the key, an edited one gets a fresh key. */
  async function run(key: ActionKey, fingerprint: unknown, call: (headers: Record<string, string>) => Promise<unknown>, success: string) {
    setPending(key);
    const scope = `${key}:${ret._id}:${JSON.stringify(fingerprint)}`;
    try {
      if (await runAction(() => call(keys.headers(scope)), success)) {
        keys.release(scope);
        onChanged();
      }
    } finally {
      setPending(null);
    }
  }

  async function approve() {
    const ok = await confirm({
      title: "Approve this return?",
      description: `Return ${ret.returnNumber} is approved and the goods can be received.`,
      confirmLabel: "Approve return",
    });
    if (ok) await run("approve", null, () => requester(approveReturnEndpoint, { params: { id: ret._id } }), `Return ${ret.returnNumber} approved`);
  }

  async function reject() {
    const outcome = await openDialog<typeof RejectReturnDialog, string>({ component: RejectReturnDialog, props: { returnNumber: ret.returnNumber } }).result;
    if (outcome.status === "resolved") {
      await run("reject", outcome.value, () => requester(rejectReturnEndpoint, { params: { id: ret._id }, body: { reason: outcome.value } }), `Return ${ret.returnNumber} rejected`);
    }
  }

  async function receive() {
    const outcome = await openDialog<typeof ReceiveReturnDialog, ReceivedLine[]>({
      component: ReceiveReturnDialog,
      props: { returnNumber: ret.returnNumber, lines: toReceive },
    }).result;
    if (outcome.status === "resolved") {
      await run(
        "receive",
        outcome.value,
        (headers) => requester(receiveReturnEndpoint, { params: { id: ret._id }, body: { lines: outcome.value }, headers }),
        `Return ${ret.returnNumber}: goods received`
      );
    }
  }

  async function refund() {
    const outcome = await openDialog<typeof RefundReturnDialog, { amount: string; refundReference: string }>({
      component: RefundReturnDialog,
      props: { returnNumber: ret.returnNumber },
    }).result;
    if (outcome.status === "resolved") {
      await run("refund", outcome.value, (headers) => requester(refundReturnEndpoint, { params: { id: ret._id }, body: outcome.value, headers }), `Return ${ret.returnNumber}: refund recorded`);
    }
  }

  const busy = pending !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {offerApprove ? (
        <CustomButton onClick={approve} loading={pending === "approve"} disabled={busy}>
          Approve return
        </CustomButton>
      ) : null}
      {offerReceive ? (
        <CustomButton onClick={receive} loading={pending === "receive"} disabled={busy}>
          Receive goods
        </CustomButton>
      ) : null}
      {offerRefund ? (
        <CustomButton onClick={refund} loading={pending === "refund"} disabled={busy}>
          Record refund
        </CustomButton>
      ) : null}
      {offerReject ? (
        <CustomButton variant="outline" onClick={reject} loading={pending === "reject"} disabled={busy} className="text-[var(--st-status-danger)]">
          Reject return
        </CustomButton>
      ) : null}
    </div>
  );
}

/** Rejecting needs a reason (the API requires one, max 500); it is stored as the return's notes and on the order timeline. */
function RejectReturnDialog({ returnNumber, titleId, descriptionId, resolve, dismiss }: DialogContentProps<string> & { returnNumber: string }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={`Reject return ${returnNumber}?`}
      description="A rejected return is final — it can't be reopened or refunded."
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss}>
            Keep return
          </CustomButton>
          <CustomButton
            variant="destructive"
            onClick={() => {
              if (!reason.trim()) {
                setError("Give a reason — it is recorded on the order's timeline.");
                return;
              }
              resolve(reason.trim());
            }}
          >
            Reject return
          </CustomButton>
        </>
      }
    >
      <CustomTextarea
        label="Reason"
        required
        rows={3}
        maxLength={500}
        value={reason}
        error={error}
        dir="auto"
        onChange={(event) => {
          setReason(event.target.value);
          if (error) setError(undefined);
        }}
      />
    </DialogBody>
  );
}

const DISPOSITION_OPTIONS: { value: ReturnDisposition; label: string }[] = [
  { value: "RESTOCK", label: "Restock — back into stock" },
  { value: "DISCARD", label: "Discard — not resellable" },
];

type ReceivedLine = { returnLineId: string; disposition: ReturnDisposition; inspectedCondition: string };

/**
 * Per-line inspection outcome: what the goods were actually like (mandatory, recorded beside the customer's own
 * claim) and what happens to them. Only lines with no disposition are listed — the server refuses to receive a line
 * twice. A line left without an outcome is not received now; one given an outcome needs its condition.
 */
function ReceiveReturnDialog({
  returnNumber,
  lines,
  titleId,
  descriptionId,
  resolve,
  dismiss,
}: DialogContentProps<ReceivedLine[]> & { returnNumber: string; lines: ReturnLine[] }) {
  const [choices, setChoices] = useState<Record<string, ReturnDisposition | undefined>>({});
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [conditionErrors, setConditionErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string>();

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={`Receive return ${returnNumber}`}
      description="Choose what happens to each item you've inspected. Restocked items are added back to stock; this can't be undone."
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss}>
            Cancel
          </CustomButton>
          <CustomButton
            onClick={() => {
              const chosen = lines.filter((line) => choices[line.returnLineId]);
              if (chosen.length === 0) {
                setError("Choose an outcome for at least one item.");
                return;
              }
              const missing = inspectedConditionErrors(chosen.map((line) => ({ id: line.returnLineId, inspectedCondition: conditions[line.returnLineId] ?? "" })));
              setConditionErrors(missing);
              if (Object.keys(missing).length > 0) return;
              resolve(chosen.map((line) => ({ returnLineId: line.returnLineId, disposition: choices[line.returnLineId]!, inspectedCondition: conditions[line.returnLineId]!.trim() })));
            }}
          >
            Confirm receipt
          </CustomButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {lines.map((line) => (
          <div key={line.returnLineId} className="flex flex-col gap-1.5">
            <p className="text-[14px]">
              <span dir="auto" className="font-medium">
                {line.productName}
              </span>{" "}
              <span className="st-figure whitespace-nowrap text-[var(--st-ink-muted)]">
                {line.sku} × {line.quantity}
              </span>
            </p>
            <p className="text-[13px] text-[var(--st-ink-muted)]">
              The customer said: <span dir="auto">{line.condition}</span>
            </p>
            <CustomSelect<ReturnDisposition>
              label="Outcome"
              placeholder="Not received yet"
              options={DISPOSITION_OPTIONS}
              value={choices[line.returnLineId]}
              onChange={(value) => {
                setChoices((current) => ({ ...current, [line.returnLineId]: value as ReturnDisposition }));
                if (error) setError(undefined);
              }}
            />
            {choices[line.returnLineId] ? (
              <CustomInput
                label="Condition found"
                required
                maxLength={200}
                dir="auto"
                placeholder="e.g. Unopened, sealed"
                value={conditions[line.returnLineId] ?? ""}
                error={conditionErrors[line.returnLineId]}
                onChange={(event) => {
                  setConditions((current) => ({ ...current, [line.returnLineId]: event.target.value }));
                  if (conditionErrors[line.returnLineId]) setConditionErrors((current) => ({ ...current, [line.returnLineId]: undefined }));
                }}
              />
            ) : null}
          </div>
        ))}
        {error ? (
          <p role="alert" className="text-[13px] text-[var(--st-status-danger)]">
            {error}
          </p>
        ) : null}
      </div>
    </DialogBody>
  );
}

/** Records a refund that already happened (the system never moves money). Amount and reference are both mandatory; over-refund is the server's 409. */
function RefundReturnDialog({
  returnNumber,
  titleId,
  descriptionId,
  resolve,
  dismiss,
}: DialogContentProps<{ amount: string; refundReference: string }> & { returnNumber: string }) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; reference?: string }>({});

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={`Record refund for ${returnNumber}`}
      description="Enter the amount you've already paid back and the transfer reference. The refund can't exceed what remains refundable on the order."
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss}>
            Cancel
          </CustomButton>
          <CustomButton
            onClick={() => {
              const next = {
                amount: refundAmountError(amount),
                reference: reference.trim() ? undefined : "A reference is required — proof the money moved.",
              };
              setErrors(next);
              if (!next.amount && !next.reference) resolve({ amount: amount.trim(), refundReference: reference.trim() });
            }}
          >
            Record refund
          </CustomButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <CustomInput
          label="Amount"
          required
          inputMode="decimal"
          dir="ltr"
          placeholder="0.00"
          value={amount}
          error={errors.amount}
          onChange={(event) => {
            setAmount(event.target.value);
            if (errors.amount) setErrors((current) => ({ ...current, amount: undefined }));
          }}
        />
        <CustomInput
          label="Reference"
          required
          maxLength={200}
          dir="auto"
          value={reference}
          error={errors.reference}
          onChange={(event) => {
            setReference(event.target.value);
            if (errors.reference) setErrors((current) => ({ ...current, reference: undefined }));
          }}
        />
      </div>
    </DialogBody>
  );
}
