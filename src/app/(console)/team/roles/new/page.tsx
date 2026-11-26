import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { createRoleEndpoint } from "src/api/roles.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { RoleForm } from "src/features/team/role-form";

export const metadata: Metadata = { title: "New role" };

export default function NewRolePage() {
  return (
    <PermissionGuard permission={AppPermission.ROLE.CREATE} fallback={<NoAccess />}>
      <PageShell title="New role" backRoute={{ path: AppRoute.ROLES, label: "Roles" }}>
        <RoleForm endpoint={createRoleEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
