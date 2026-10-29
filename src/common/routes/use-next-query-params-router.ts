"use client";

import type { QueryParamsRouterState } from "@kira-joo/frontend-toolkit-core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** The Next adapter the toolkit's URL-synced lists need (search, filters, sort and page live in the URL). */
export function useNextQueryParamsRouter(): QueryParamsRouterState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navigate = useCallback(
    (next: URLSearchParams, options?: { replace?: boolean }) => {
      const query = next.toString();
      const href = query ? `${pathname}?${query}` : pathname;
      if (options?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router, pathname]
  );

  return { searchParams, navigate };
}
