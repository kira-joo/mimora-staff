import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { TeamTable } from "src/features/team/team-table";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <PermissionGuard permission={AppPermission.STAFF_USER.READ} fallback={<NoAccess />}>
      <PageShell title="Team" description="Who can sign in to this console. Create an account directly with a password, or invite someone to choose their own.">
        <TeamTable />
      </PageShell>
    </PermissionGuard>
  );
}
