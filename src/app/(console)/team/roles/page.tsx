import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { RolesView } from "src/features/team/roles-view";

export const metadata: Metadata = { title: "Roles" };

export default function RolesPage() {
  return (
    <PermissionGuard permission={AppPermission.ROLE.READ} fallback={<NoAccess />}>
      <PageShell title="Roles" description="The fixed set of roles you can give to team members. They can't be edited here." backRoute={{ path: AppRoute.TEAM, label: "Team" }}>
        <RolesView />
      </PageShell>
    </PermissionGuard>
  );
}
