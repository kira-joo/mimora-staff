import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { TeamTable } from "src/features/team/team-table";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <PermissionGuard permission={CustomPermission.STAFF_MANAGE} fallback={<NoAccess />}>
      <PageShell title="Team" description="Who can sign in to this console. Accounts are by invitation only.">
        <TeamTable />
      </PageShell>
    </PermissionGuard>
  );
}
