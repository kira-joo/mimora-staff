"use client";

import {
  APIConfig,
  AppLinkConfig,
  QueryParamsRouterProvider,
  ToolkitProviders,
  clearAuthenticatedQueries,
  createToolkitQueryClient,
  getDefaultApiClient,
  type AppLinkComponentProps,
} from "@kira-joo/frontend-toolkit-core";
import { Toaster, showApiErrorToast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { MotionConfig } from "motion/react";
import Link from "next/link";
import { Suspense, type ComponentType, type ReactNode } from "react";
import { refreshSessionEndpoint } from "src/api/auth.endpoints";
import { AppRoute, SIGNED_OUT_ROUTES } from "src/common/routes/app-route";
import { useNextQueryParamsRouter } from "src/common/routes/use-next-query-params-router";

/** One error toast for every failed query or mutation; a call opts out with `meta: { skipErrorToast: true }`. */
export const queryClient = createToolkitQueryClient({ onError: (error) => showApiErrorToast(error) });

/*
 * Same-origin `/api`: the staff cookies are HttpOnly and set by this backend,
 * so the browser attaches them itself — no JavaScript ever reads, stores or
 * forwards a token.
 */
APIConfig.baseURL = "/api";

/*
 * A 401 means the 15-minute access token lapsed. The toolkit single-flights
 * this refresh and retries the request once; `skipAuthRefresh` keeps a failed
 * refresh from waiting on itself.
 */
APIConfig.refreshAuth = async () => {
  try {
    await getDefaultApiClient().request(refreshSessionEndpoint, { skipAuthRefresh: true });
    return true;
  } catch {
    return false;
  }
};

/*
 * The session is gone (refresh refused): drop private data and sign in again,
 * coming back here after. The toolkit calls this on every final 401 — even one
 * sent with `skipAuthRefresh` — so the signed-out screens are exempt: there a
 * 401 is the answer to a wrong password or invitation code.
 */
APIConfig.onUnauthorized = () => {
  clearAuthenticatedQueries(queryClient);
  if (typeof window === "undefined" || SIGNED_OUT_ROUTES.includes(window.location.pathname)) return;
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`${AppRoute.LOGIN}?redirectTo=${encodeURIComponent(here)}`);
};

AppLinkConfig.Component = Link as unknown as ComponentType<AppLinkComponentProps>;

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToolkitProviders client={queryClient}>
      <MotionConfig reducedMotion="user">
        {/* useSearchParams in the router adapter needs a Suspense boundary for static rendering. */}
        <Suspense>
          <QueryParamsRouterProvider useAdapter={useNextQueryParamsRouter}>
            {children}
            <Toaster />
          </QueryParamsRouterProvider>
        </Suspense>
      </MotionConfig>
    </ToolkitProviders>
  );
}
