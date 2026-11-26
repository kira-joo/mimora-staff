import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { NewRoleButton, RolesView } from "src/features/team/roles-view";

export const metadata: Metadata = { title: "Roles" };

export default function RolesPage() {
  return (
    <PermissionGuard permission={AppPermission.ROLE.READ} fallback={<NoAccess />}>
      <PageShell
        title="Roles"
        description="What each role lets its holders see and do. Edit them, or create new ones; the store always keeps at least one active Owner."
        backRoute={{ path: AppRoute.TEAM, label: "Team" }}
        actions={<NewRoleButton />}
      >
        <RolesView />
      </PageShell>
    </PermissionGuard>
  );
}
