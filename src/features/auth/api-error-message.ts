import { isApiError } from "@kira-joo/frontend-toolkit-core";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

/** What to tell a signed-out user about a failed auth request — the server's own message where it has one. */
export function authErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error)) return fallback;
  if (error.statusCode === 429) return "Too many attempts. Wait a few minutes, then try again.";
  if (error.statusCode === undefined) return "Can't reach the server. Check your connection and try again.";
  return error.message || fallback;
}

/**
 * Puts a server validation error on its field — what CustomForm's own
 * endpoint path does, repeated for the auth forms because they submit through
 * `onSubmit` (see login-form.tsx for why).
 */
export function applyServerFieldErrors<T extends FieldValues>(error: unknown, form: UseFormReturn<T>): void {
  if (!isApiError(error)) return;
  for (const { field, message } of error.validationErrors ?? []) form.setError(field as Path<T>, { type: "server", message });
}
