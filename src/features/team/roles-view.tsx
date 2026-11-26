"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { useConfirm } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomButton, QueryState, RouteButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { deleteRoleEndpoint, listRolesEndpoint, type Role } from "src/api/roles.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { memberLabel } from "./role-helpers";
import { groupPermissions, humanizeEntity } from "./role-permissions";

/** Every role with who holds it and what it allows. Editing and deleting are offered only to those who may. */
export function RolesView() {
  const query = useRequesterQuery({ endpoint: listRolesEndpoint, options: { query: { limit: 100 } } });
  return (
    <QueryState query={query} entityName="roles">
      {(page) =>
        page.data.length === 0 ? (
          <p className="text-[var(--st-ink-muted)]">No roles yet. Create one to start giving people access.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {page.data.map((role) => (
              <RoleCard key={role._id} role={role} />
            ))}
          </div>
        )
      }
    </QueryState>
  );
}

function RoleCard({ role }: { role: Role }) {
  const can = usePermission();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const groups = groupPermissions(role.permissions.filter((permission) => permission.isActive));
  const deleteBlocked = role.isOwnerRole ? "The Owner role can't be deleted." : role.memberCount > 0 ? "Give its members another role first." : null;

  async function remove() {
    const ok = await confirm({
      title: `Delete the ${role.name} role?`,
      description: "Nobody holds it, so nobody loses access. This can't be undone.",
      confirmLabel: "Delete role",
      destructive: true,
    });
    if (!ok) return;
    if (await runAction(() => requester(deleteRoleEndpoint, { params: { id: role._id } }), "Role deleted")) void queryClient.invalidateQueries();
  }

  return (
    <section className="border border-[var(--st-line)] bg-[var(--st-surface)] p-5" aria-labelledby={`role-${role._id}`}>
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={`role-${role._id}`} dir="auto" className="min-w-0 break-words text-[18px] font-semibold">
          {role.name}
        </h2>
        {role.grantsAll ? (
          <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--st-status-done)" }}>
            <ShieldCheck aria-hidden="true" className="size-3.5" /> Full access
          </span>
        ) : (
          <span className="text-[var(--st-ink-muted)]">{role.permissions.filter((permission) => permission.isActive).length} permissions</span>
        )}
        {role.isActive ? null : <span className="font-medium text-[var(--st-status-pending)]">Inactive</span>}
        <span className="inline-flex items-center gap-1.5 text-[var(--st-ink-muted)]">
          <Users aria-hidden="true" className="size-3.5" />
          {memberLabel(role.memberCount)}
          {role.memberCount > role.activeMemberCount ? ` (${role.memberCount - role.activeMemberCount} deactivated)` : ""}
        </span>
        <div className="ms-auto flex gap-2">
          {can(AppPermission.ROLE.UPDATE) ? (
            <Link
              href={AppRoute.ROLE(role._id)}
              className="inline-flex min-h-[var(--st-tap-min)] items-center gap-2 border border-[var(--st-line-strong)] px-3 text-[13px] font-medium hover:bg-[var(--st-canvas)]"
              aria-label={`Edit ${role.name}`}
            >
              <Pencil aria-hidden="true" className="size-4" /> Edit
            </Link>
          ) : null}
          {can(AppPermission.ROLE.DELETE) ? (
            <CustomButton type="button" variant="outline" leftIcon={Trash2} disabled={Boolean(deleteBlocked)} title={deleteBlocked ?? undefined} aria-label={`Delete ${role.name}`} onClick={() => void remove()}>
              Delete
            </CustomButton>
          ) : null}
        </div>
      </header>
      {role.grantsAll ? (
        <p className="text-[var(--st-ink-muted)]">Can do everything, including anything added later.</p>
      ) : groups.length === 0 ? (
        <p className="text-[var(--st-ink-muted)]">No permissions.</p>
      ) : (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[160px_minmax(0,1fr)]">
          {groups.map((group) => (
            <div key={group.entity} className="contents">
              <dt className="font-medium">{humanizeEntity(group.entity)}</dt>
              <dd className="text-[var(--st-ink-muted)]">{group.items.map((item) => item.label).join(" · ")}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** The page's "New role" action — a client component because its icon cannot cross the Server Component boundary. */
export function NewRoleButton() {
  return (
    <RouteButton path={AppRoute.ROLE_NEW} permission={AppPermission.ROLE.CREATE} leftIcon={Plus}>
      New role
    </RouteButton>
  );
}
