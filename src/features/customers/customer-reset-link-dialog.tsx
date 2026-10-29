"use client";

import { CustomButton, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { DialogBody, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { CustomerResetLink } from "src/api/customers.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { resetLinkText } from "./reset-link";

/**
 * Shows a customer's password-reset link ONCE, the way the staff invitation panel does:
 * the credential lives only in this dialog's props — never in storage, never logged —
 * and there is no email transport, so staff deliver it by another channel.
 */
export function CustomerResetLinkDialog({ link, name, titleId, descriptionId, dismiss }: DialogContentProps<void> & { link: CustomerResetLink; name: string }) {
  const format = useStoreFormat();
  const [copied, setCopied] = useState(false);
  const text = resetLinkText(link);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title="Password reset link"
      description="Any earlier reset link for this customer no longer works."
      actions={
        <CustomButton type="button" onClick={dismiss}>
          Done
        </CustomButton>
      }
    >
      <div className="flex flex-col gap-3">
        <p>
          Send this link to <span dir="auto" className="font-medium">{name}</span> by phone or message. Email is not set up, so nothing was sent.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            aria-label="Password reset link"
            dir="ltr"
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            className="st-figure min-h-[var(--st-tap-min)] min-w-0 flex-1 border border-[var(--st-line-strong)] bg-[var(--st-canvas)] px-3 text-[13px]"
          />
          <CustomButton type="button" leftIcon={copied ? Check : Copy} onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </CustomButton>
        </div>
        {link.resetUrl ? null : (
          <p role="note" className="text-[13px] text-[var(--st-ink-muted)]">
            This is the page path only: put the store&apos;s own address in front of it.
          </p>
        )}
        <p role="note" className="text-[13px] text-[var(--st-ink-muted)]">
          This link is shown only now. It is not stored, so once you close this you can&apos;t see it again. It works once and expires {format.dateTime(link.expiresAt)}. Using it signs the
          customer out everywhere. If it is lost, create a new one: that cancels this one.
        </p>
      </div>
    </DialogBody>
  );
}
