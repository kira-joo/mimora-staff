"use client";

import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { DialogBody, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import type { StaffInvitation } from "src/api/staff.endpoints";
import { InvitationPanel } from "./invitation-panel";

export function InvitationDialog({ invitation, name, titleId, descriptionId, dismiss }: DialogContentProps<void> & { invitation: StaffInvitation; name: string }) {
  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title="New invitation link"
      description="Any earlier link for this person no longer works."
      actions={
        <CustomButton type="button" onClick={dismiss}>
          Done
        </CustomButton>
      }
    >
      <InvitationPanel invitation={invitation} name={name} />
    </DialogBody>
  );
}
