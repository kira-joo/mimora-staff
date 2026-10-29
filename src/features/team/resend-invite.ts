import { requester } from "@kira-joo/frontend-toolkit-core";
import { useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { resendStaffInviteEndpoint, type StaffInvitation } from "src/api/staff.endpoints";
import { runAction } from "src/common/feedback/run-action";
import { InvitationDialog } from "./invitation-dialog";

/** Re-mints a member's invitation and shows the new link once. Refusals (already activated) surface as the error toast. */
export function useResendInvite() {
  const { openDialog } = useDialog();
  return async function resend(member: { _id: string; name: string }) {
    let invitation: StaffInvitation | undefined;
    const ok = await runAction(async () => {
      invitation = await requester(resendStaffInviteEndpoint, { params: { id: member._id } });
    });
    if (ok && invitation) {
      await openDialog<typeof InvitationDialog, void>({ component: InvitationDialog, props: { invitation, name: member.name } }).result;
    }
    return ok;
  };
}
