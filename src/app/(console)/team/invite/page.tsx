import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { inviteStaffEndpoint } from "src/api/staff.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { StaffForm } from "src/features/team/staff-form";

export const metadata: Metadata = { title: "Invite member" };

export default function InviteStaffPage() {
  return (
    <PermissionGuard permission={CustomPermission.STAFF_MANAGE} fallback={<NoAccess />}>
      <PageShell title="Invite member" backRoute={{ path: AppRoute.TEAM, label: "Team" }}>
        <StaffForm endpoint={inviteStaffEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
