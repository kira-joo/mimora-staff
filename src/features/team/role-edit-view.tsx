"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getRoleEndpoint, updateRoleEndpoint } from "src/api/roles.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { RoleForm } from "./role-form";
import { memberLabel } from "./role-helpers";

export function RoleEditView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getRoleEndpoint, options: { params: { id } }, queryOptions: { refetchOnMount: "always", refetchOnWindowFocus: false } });
  return (
    <QueryState query={query} entityName="role" backRoute={{ path: AppRoute.ROLES, label: "Roles" }}>
      {(role) => (
        <PageShell
          title={<span dir="auto">{role.name}</span>}
          description={`${memberLabel(role.memberCount)} ${role.memberCount === 1 ? "has" : "have"} this role.`}
          backRoute={{ path: AppRoute.ROLES, label: "Roles" }}
        >
          <RoleForm key={role.updatedAt} endpoint={updateRoleEndpoint} oldData={role} />
        </PageShell>
      )}
    </QueryState>
  );
}
