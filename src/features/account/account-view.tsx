"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { QueryState, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { changeOwnPasswordEndpoint, getOwnAccountEndpoint, updateOwnAccountEndpoint, type OwnAccount } from "src/api/account.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { PermissionMatrix } from "src/features/team/permission-matrix";
import { STAFF_PASSWORD_MIN } from "src/features/team/create-staff-helpers";
import { EMPTY_PASSWORD_FORM, accountPermissions, passwordProblems, type PasswordFormValues } from "./account-helpers";

/** The signed-in person's own account: profile, access (read-only) and password. Nothing here can touch anyone else. */
export function AccountView() {
  const query = useRequesterQuery({ endpoint: getOwnAccountEndpoint, options: {}, queryOptions: { refetchOnWindowFocus: false } });
  return (
    <QueryState query={query} entityName="your account">
      {(account) => (
        <div className="flex flex-col gap-6">
          {account.mustChangePassword ? (
            <p role="alert" className="flex items-start gap-2 border border-[var(--st-status-pending)] bg-[var(--st-surface)] p-4 font-medium text-[var(--st-status-pending)]">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Choose your own password to continue. Your account was set up with a temporary one, and nothing else in the console works until you replace it.
            </p>
          ) : null}
          <ProfileSection key={account.name} account={account} />
          <PasswordSection mustChange={account.mustChangePassword} />
          <AccessSection account={account} />
        </div>
      )}
    </QueryState>
  );
}

const profileSections: FormSection<{ name: string }>[] = [
  {
    title: "Profile",
    columns: 1,
    fields: [{ type: FieldType.INPUT, name: "name", label: "Display name", rules: { required: "Enter your name.", maxLength: { value: 120, message: "Use at most 120 characters." } } }],
  },
];

function ProfileSection({ account }: { account: OwnAccount }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const format = useStoreFormat();
  const form = useForm<{ name: string }>({ defaultValues: { name: account.name } });
  return (
    <div className="flex flex-col gap-3">
      <CustomForm<{ name: string }, typeof updateOwnAccountEndpoint>
        form={form}
        mode="edit"
        sections={profileSections}
        submitEndpoint={updateOwnAccountEndpoint}
        transformValues={(values) => ({ name: values.name.trim() })}
        submitButtonText="Save name"
        onSuccess={(saved) => {
          form.reset({ name: saved.name });
          toast.success("Name saved");
          void queryClient.invalidateQueries();
          router.refresh(); // the top bar shows the name, and it is rendered from the server session
        }}
      />
      <dl className="grid gap-x-6 gap-y-2 border border-[var(--st-line)] bg-[var(--st-surface)] p-5 sm:grid-cols-[160px_minmax(0,1fr)]">
        <dt className="font-medium">Email</dt>
        <dd className="min-w-0 break-all">
          <bdi dir="ltr">{account.email}</bdi>
          <span className="block text-[13px] text-[var(--st-ink-muted)]">Only an administrator can change it.</span>
        </dd>
        <dt className="font-medium">Last sign-in</dt>
        <dd>{account.lastLoginAt ? format.dateTime(account.lastLoginAt) : "—"}</dd>
        {account.createdAt ? (
          <>
            <dt className="font-medium">Member since</dt>
            <dd>{format.dateTime(account.createdAt)}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

const passwordSections: FormSection<PasswordFormValues>[] = [
  {
    title: "Password",
    description: "Changing it signs you out everywhere else. You stay signed in here.",
    columns: 1,
    fields: [
      { type: FieldType.INPUT, name: "currentPassword", label: "Current password", inputType: "password", rules: { required: "Enter your current password." } },
      { type: FieldType.INPUT, name: "newPassword", label: "New password", inputType: "password", description: `At least ${STAFF_PASSWORD_MIN} characters.`, rules: { required: "Enter a new password." } },
      { type: FieldType.INPUT, name: "confirmPassword", label: "Confirm new password", inputType: "password", rules: { required: "Enter the new password again." } },
    ],
  },
];

function PasswordSection({ mustChange }: { mustChange: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<PasswordFormValues>({ defaultValues: EMPTY_PASSWORD_FORM });
  return (
    <CustomForm<PasswordFormValues, typeof changeOwnPasswordEndpoint>
      form={form}
      mode="create"
      sections={passwordSections}
      submitEndpoint={changeOwnPasswordEndpoint}
      transformValues={(values) => ({ currentPassword: values.currentPassword, newPassword: values.newPassword })}
      confirmSubmit={(values) => {
        const problems = passwordProblems(values, STAFF_PASSWORD_MIN);
        for (const [field, message] of Object.entries(problems)) form.setError(field as keyof PasswordFormValues, { message });
        return Object.keys(problems).length === 0;
      }}
      submitButtonText="Change password"
      onSuccess={() => {
        form.reset(EMPTY_PASSWORD_FORM);
        toast.success("Password changed. Other sessions were signed out.");
        void queryClient.invalidateQueries();
        router.refresh();
        if (mustChange) router.replace(AppRoute.HOME);
      }}
    />
  );
}

function AccessSection({ account }: { account: OwnAccount }) {
  const permissions = accountPermissions(account);
  return (
    <section aria-labelledby="access-heading" className="flex flex-col gap-4 border border-[var(--st-line)] bg-[var(--st-surface)] p-5">
      <header className="flex flex-col gap-1">
        <h2 id="access-heading" className="text-[18px] font-semibold">
          Your access
        </h2>
        <p className="text-[var(--st-ink-muted)]">Read-only. An administrator with access to roles can change it.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {account.roles.length === 0 ? <span className="text-[var(--st-ink-muted)]">No roles yet.</span> : null}
        {account.roles.map((role) => (
          <span key={role._id} dir="auto" className="inline-flex min-h-8 items-center gap-1.5 border border-[var(--st-line-strong)] px-2.5 text-[13px] font-medium">
            {role.grantsAll ? <ShieldCheck aria-hidden="true" className="size-3.5" style={{ color: "var(--st-status-done)" }} /> : <KeyRound aria-hidden="true" className="size-3.5" />}
            {role.name}
            {role.isActive ? null : <span className="text-[var(--st-ink-muted)]">(inactive)</span>}
          </span>
        ))}
      </div>
      {account.mustChangePassword ? (
        <p className="text-[var(--st-ink-muted)]">Your permissions apply once you have chosen your own password.</p>
      ) : account.grantsAll ? (
        <p className="inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--st-status-done)" }}>
          <ShieldCheck aria-hidden="true" className="size-4" /> Full access — everything, including anything added later.
        </p>
      ) : permissions.length === 0 ? (
        <p className="text-[var(--st-ink-muted)]">Your roles don&apos;t give you any permissions yet.</p>
      ) : (
        <PermissionMatrix permissions={permissions} value={new Set(account.effectivePermissions)} />
      )}
    </section>
  );
}
