"use client";

import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { StaffInvitation } from "src/api/staff.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { buildInviteLink } from "./invite-link";

/**
 * Shows the accept-invite link once. The token lives only in this component's
 * props/state — never in storage — and there is no mail transport, so the
 * administrator hands the link over themselves.
 */
export function InvitationPanel({ invitation, name }: { invitation: StaffInvitation; name: string }) {
  const format = useStoreFormat();
  const [copied, setCopied] = useState(false);
  const link = buildInviteLink(window.location.origin, invitation.token);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p>
        Send this link to <span dir="auto" className="font-medium">{name}</span>. Email is not set up here, so nothing was sent.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          aria-label="Invitation link"
          dir="ltr"
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          className="st-figure min-h-[var(--st-tap-min)] min-w-0 flex-1 border border-[var(--st-line-strong)] bg-[var(--st-canvas)] px-3 text-[13px]"
        />
        <CustomButton type="button" leftIcon={copied ? Check : Copy} onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </CustomButton>
      </div>
      <p role="note" className="text-[13px] text-[var(--st-ink-muted)]">
        This link is shown only now. It is not stored, so once you close this you can&apos;t see it again. It expires {format.dateTime(invitation.expiresAt)}. If it is lost,
        resend the invitation: that makes a new link and cancels this one.
      </p>
    </div>
  );
}
