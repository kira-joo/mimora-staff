"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomCheckbox } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { listRolesEndpoint } from "src/api/roles.endpoints";

/** Role picker for a staff member. Inactive roles show only when already assigned. */
export function RoleChecklist({ value, onChange, disabled, error }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; error?: string }) {
  const query = useRequesterQuery({ endpoint: listRolesEndpoint, options: { query: { limit: 100 } } });
  const roles = (query.data?.data ?? []).filter((role) => role.isActive || value.includes(role._id));

  return (
    <fieldset className="flex flex-col gap-1" disabled={disabled}>
      <legend className="mb-1 text-[14px] font-medium">Roles</legend>
      {query.isLoading ? <p className="text-[var(--st-ink-muted)]">Loading roles…</p> : null}
      {query.isError ? (
        <p role="alert" className="text-[var(--st-status-danger)]">
          Roles couldn&apos;t be loaded. Listing roles needs its own permission, separate from managing staff.
        </p>
      ) : null}
      {roles.map((role) => (
        <div key={role._id} className="flex min-h-[var(--st-tap-min)] items-center border border-[var(--st-line)] px-3">
          <CustomCheckbox
            label={role.name + (role.isActive ? "" : " (inactive)")}
            description={role.grantsAll ? "Full access" : `${role.permissions.length} permissions`}
            checked={value.includes(role._id)}
            onChange={(event) => onChange(event.target.checked ? [...value, role._id] : value.filter((id) => id !== role._id))}
          />
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-[13px] text-[var(--st-status-danger)]">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
