"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { AppRoute } from "src/common/routes/app-route";

/**
 * Rendered by the console layout when there is no valid session on the
 * request. Sends the browser to sign-in with the current location, where a
 * silent refresh restores the session if the refresh cookie is still good.
 */
export function SessionRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    const here = query ? `${pathname}?${query}` : pathname;
    router.replace(`${AppRoute.LOGIN}?redirectTo=${encodeURIComponent(here)}`);
  }, [pathname, router, searchParams]);

  return (
    <p role="status" className="px-6 py-20 text-center text-[var(--st-ink-muted)]">
      Checking your session…
    </p>
  );
}
