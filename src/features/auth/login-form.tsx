"use client";

import { getDefaultApiClient } from "@kira-joo/frontend-toolkit-core";
import { CustomForm, FieldType, type FormFieldConfig } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { AnimatePresence } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { loginEndpoint, refreshSessionEndpoint } from "src/api/auth.endpoints";
import { safeRedirectPath } from "src/common/routes/app-route";
import { AuthStage, FormAlert } from "./auth-stage";
import { applyServerFieldErrors, authErrorMessage } from "./api-error-message";

interface LoginValues {
  email: string;
  password: string;
}

/*
 * CUSTOM fields only to set autoComplete (a password manager needs it to fill
 * a sign-in; WCAG 1.3.5): FormInput accepts it, but the INPUT field config
 * does not declare it. The control is still the toolkit's own CustomInput.
 */
const FIELDS: FormFieldConfig<LoginValues>[] = [
  {
    type: FieldType.CUSTOM,
    name: "email",
    rules: { required: "Enter your email." },
    render: ({ field, error }) => (
      <CustomInput {...field} value={field.value ?? ""} label="Email" type="email" autoComplete="username" inputMode="email" autoFocus required error={error} />
    ),
  },
  {
    type: FieldType.CUSTOM,
    name: "password",
    rules: { required: "Enter your password." },
    render: ({ field, error }) => (
      <CustomInput {...field} value={field.value ?? ""} label="Password" type="password" autoComplete="current-password" required error={error} />
    ),
  },
];

/**
 * Sign-in: session restoration first, then the toolkit's CustomForm.
 *
 * Restoration — the refresh cookie is scoped to /api/admin/auth/token, so
 * pages never see it; someone returning after their 15-minute access token
 * lapsed lands here with a good session, and one silent refresh lets them
 * straight back in.
 *
 * Why `onSubmit` rather than `submitEndpoint`: CustomForm's endpoint path
 * submits through useRequesterMutation, which cannot pass `skipAuthRefresh`
 * or a mutation `meta`. A wrong password (401) would then trigger the
 * toolkit's refresh-on-401 — a pointless refresh call — and the global error
 * toast would repeat the message CustomForm already shows. So CustomForm owns
 * the fields, validation, busy state and rendering, and this component owns
 * only the call and the one form-level message (CustomForm's own form error
 * is set only on its endpoint path).
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = safeRedirectPath(searchParams.get("redirectTo"));
  const [restoring, setRestoring] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDefaultApiClient()
      .request(refreshSessionEndpoint, { skipAuthRefresh: true })
      .then(() => {
        if (cancelled) return;
        setRedirecting(true);
        router.replace(destination);
        router.refresh();
      })
      .catch(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [destination, router]);

  return (
    <AuthStage
      eyebrow="Store console"
      title="Sign in"
      description={restoring ? "Checking your session…" : searchParams.get("redirectTo") ? "Your session ended. Sign in to pick up where you left off." : "Staff access only."}
    >
      <AnimatePresence initial={false}>{error ? <FormAlert id="login-error">{error}</FormAlert> : null}</AnimatePresence>
      <CustomForm<LoginValues>
        sections={[{ fields: FIELDS, card: false }]}
        defaultValues={{ email: "", password: "" }}
        submitButtonText="Sign in"
        loading={restoring || redirecting}
        actionsClassName="[&_button]:w-full"
        onSubmit={async (values, form) => {
          setError(null);
          try {
            await getDefaultApiClient().request(loginEndpoint, { body: { email: values.email.trim(), password: values.password }, skipAuthRefresh: true });
            setRedirecting(true);
            router.replace(destination);
            router.refresh();
          } catch (caught) {
            setError(authErrorMessage(caught, "Invalid email or password."));
            applyServerFieldErrors(caught, form);
            form.resetField("password");
          }
        }}
      />
      <p className="mt-5 text-[13px] text-[var(--st-ink-muted)]">
        New here? Use the invitation code your administrator gave you to{" "}
        <a href="/accept-invite" className="font-medium text-[var(--st-accent)] underline underline-offset-2">
          activate your account
        </a>
        .
      </p>
    </AuthStage>
  );
}
