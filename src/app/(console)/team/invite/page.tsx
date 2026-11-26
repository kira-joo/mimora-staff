import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import Link from "next/link";
import { inviteStaffEndpoint } from "src/api/staff.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { StaffForm } from "src/features/team/staff-form";

export const metadata: Metadata = { title: "Invite member" };

export default function InviteStaffPage() {
  return (
    <PermissionGuard permission={AppPermission.STAFF_USER.CREATE} fallback={<NoAccess />}>
      <PageShell
        title="Invite member"
        description={
          <>
            They get a one-time link and choose their own password. Need the account working right now?{" "}
            <Link href={AppRoute.TEAM_CREATE} className="font-medium text-[var(--st-accent)] underline underline-offset-2">
              Create it directly
            </Link>
            .
          </>
        }
        backRoute={{ path: AppRoute.TEAM, label: "Team" }}
      >
        <StaffForm endpoint={inviteStaffEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
