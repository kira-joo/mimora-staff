import { isApiError } from "@kira-joo/frontend-toolkit-core";
import { showApiErrorToast, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";

/**
 * Runs one staff action against the API and reports the outcome.
 *
 * Needed because these calls go through `requester`, outside React Query, so
 * the QueryClient's global error toast never sees them — and the toolkit's
 * table only logs a failed row action. Without this, a server refusal (a 409
 * transition conflict, a 403, an over-refund) would fail silently.
 * Resolves `true` on success, `false` once the error has been shown.
 */
export async function runAction(call: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await call();
    if (success) toast.success(success);
    return true;
  } catch (error) {
    showApiErrorToast(isApiError(error) ? error : { message: "Something went wrong. Try again." });
    return false;
  }
}
