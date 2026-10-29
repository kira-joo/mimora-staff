"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { DialogBody, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { CustomSelect } from "@kira-joo/frontend-toolkit-tailwind/select";
import { useState } from "react";
import { REDACTION_REASONS, REDACT_CONFIRMATION, redactCustomerEndpoint, type RedactionReason } from "src/api/customers.endpoints";
import { runAction } from "src/common/feedback/run-action";

/**
 * Redacting a customer is irreversible, so it takes three deliberate steps: a reason (from a closed list — it is
 * written to the audit log, which holds no personal data), typing the confirmation word, and the button. The API
 * requires the reason and the same word itself; this only makes the step visible.
 */
export function RedactCustomerDialog({ customer, titleId, descriptionId, resolve, dismiss }: DialogContentProps<boolean> & { customer: { _id: string; name: string } }) {
  const [reason, setReason] = useState<RedactionReason>("CUSTOMER_REQUEST");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmed = typed.trim() === REDACT_CONFIRMATION;

  async function submit() {
    setBusy(true);
    const ok = await runAction(() => requester(redactCustomerEndpoint, { params: { id: customer._id }, body: { reason, confirm: REDACT_CONFIRMATION } }), "Customer redacted");
    if (ok) resolve(true);
    else setBusy(false);
  }

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title="Delete this customer's data?"
      description={<span dir="auto">{customer.name}</span>}
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss} disabled={busy}>
            Cancel
          </CustomButton>
          <CustomButton onClick={submit} loading={busy} disabled={!confirmed || busy} variant="destructive">
            Delete customer data
          </CustomButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="font-medium">This can&apos;t be undone.</p>
          <ul className="ms-5 list-disc text-[var(--st-ink-muted)]">
            <li>The name, phone, email and password are removed, and the customer is signed out everywhere and can no longer sign in.</li>
            <li>Saved addresses, the cart, the wishlist and the newsletter subscription are deleted.</li>
            <li>Their reviews stay, shown as written by a deleted customer.</li>
            <li>
              <span className="font-medium text-[var(--st-ink)]">Orders are kept</span> as financial records, with the name and address they were placed with.
            </li>
            <li>The same phone number or email can register a new account afterwards.</li>
          </ul>
        </div>
        <CustomSelect<RedactionReason> label="Reason" options={[...REDACTION_REASONS]} value={reason} onChange={(v) => setReason(v as RedactionReason)} />
        <CustomInput
          label={`Type ${REDACT_CONFIRMATION} to confirm`}
          autoComplete="off"
          dir="ltr"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
    </DialogBody>
  );
}
