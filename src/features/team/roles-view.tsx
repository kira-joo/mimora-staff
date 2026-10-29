"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { ShieldCheck } from "lucide-react";
import { listRolesEndpoint, type Role } from "src/api/roles.endpoints";
import { groupPermissions, humanizeEntity } from "./role-permissions";

/** Read-only: the API has no create, edit or delete for roles. */
export function RolesView() {
  const query = useRequesterQuery({ endpoint: listRolesEndpoint, options: { query: { limit: 100 } } });
  return (
    <QueryState query={query} entityName="roles">
      {(page) => (
        <div className="flex flex-col gap-5">
          {page.data.map((role) => (
            <RoleCard key={role._id} role={role} />
          ))}
        </div>
      )}
    </QueryState>
  );
}

function RoleCard({ role }: { role: Role }) {
  const groups = groupPermissions(role.permissions);
  return (
    <section className="border border-[var(--st-line)] bg-[var(--st-surface)] p-5" aria-labelledby={`role-${role._id}`}>
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`role-${role._id}`} dir="auto" className="text-[18px] font-semibold">
          {role.name}
        </h2>
        {role.grantsAll ? (
          <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--st-status-done)" }}>
            <ShieldCheck aria-hidden="true" className="size-3.5" /> Full access
          </span>
        ) : (
          <span className="text-[var(--st-ink-muted)]">{role.permissions.length} permissions</span>
        )}
        {role.isActive ? null : <span className="text-[var(--st-ink-muted)]">Inactive</span>}
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
