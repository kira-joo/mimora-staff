"use client";

import { getDefaultApiClient } from "@kira-joo/frontend-toolkit-core";
import { CustomForm, FieldType, type FormFieldConfig } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { ButtonLink } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { AnimatePresence } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { acceptInviteEndpoint } from "src/api/auth.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { AuthStage, FormAlert } from "./auth-stage";
import { applyServerFieldErrors, authErrorMessage } from "./api-error-message";

/** Mirrors the backend's AcceptStaffInviteDto — checked here only to answer before a round trip. */
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

interface InviteValues {
  token: string;
  password: string;
  confirmation: string;
}

const FIELDS: FormFieldConfig<InviteValues>[] = [
  { type: FieldType.INPUT, name: "token", label: "Invitation code", rules: { required: "Enter the invitation code your administrator gave you." } },
  {
    type: FieldType.CUSTOM,
    name: "password",
    rules: {
      required: "Choose a password.",
      minLength: { value: PASSWORD_MIN, message: `Use at least ${PASSWORD_MIN} characters.` },
      maxLength: { value: PASSWORD_MAX, message: `Use at most ${PASSWORD_MAX} characters.` },
    },
    render: ({ field, error }) => (
      <CustomInput {...field} value={field.value ?? ""} label="New password" type="password" autoComplete="new-password" required description={`At least ${PASSWORD_MIN} characters.`} error={error} />
    ),
  },
  {
    type: FieldType.CUSTOM,
    name: "confirmation",
    rules: { deps: ["password"], validate: (value, values) => value === values.password || "The two passwords don't match." },
    render: ({ field, error }) => (
      <CustomInput {...field} value={field.value ?? ""} label="Confirm password" type="password" autoComplete="new-password" required error={error} />
    ),
  },
];

/**
 * Activates an invited account, on CustomForm like sign-in (and through
 * `onSubmit` for the same reason: an invalid code is a 401 that must not
 * trigger refresh-on-401). There is no mail transport (D-8), so the
 * administrator hands over the code; a link carrying `?token=` fills it in.
 * Activation does not sign in.
 */
export function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <AuthStage eyebrow="Store console" title="Account activated" description="Your password is set. Sign in to start.">
        <ButtonLink href={AppRoute.LOGIN} className="w-full">
          Continue to sign in
        </ButtonLink>
      </AuthStage>
    );
  }

  return (
    <AuthStage eyebrow="Store console" title="Activate your account" description="Choose the password you'll sign in with.">
      <AnimatePresence initial={false}>{error ? <FormAlert id="invite-error">{error}</FormAlert> : null}</AnimatePresence>
      <CustomForm<InviteValues>
        sections={[{ fields: FIELDS, card: false }]}
        defaultValues={{ token: searchParams.get("token") ?? "", password: "", confirmation: "" }}
        submitButtonText="Activate account"
        actionsClassName="[&_button]:w-full"
        onSubmit={async (values, form) => {
          setError(null);
          try {
            await getDefaultApiClient().request(acceptInviteEndpoint, { body: { token: values.token.trim(), password: values.password }, skipAuthRefresh: true });
            setDone(true);
          } catch (caught) {
            setError(authErrorMessage(caught, "This invitation link is invalid or has expired."));
            applyServerFieldErrors(caught, form);
          }
        }}
      />
    </AuthStage>
  );
}
