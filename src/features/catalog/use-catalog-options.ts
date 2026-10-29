"use client";

import { useRequesterQuery, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import { useMemo } from "react";
import type { LocalizedText } from "src/api/brands.endpoints";
import { displayName } from "./catalog-display";

/** Radix Select cannot hold an empty value, so "no selection" is this sentinel; a form maps it back before submitting. */
export const NONE = "__none__";

interface Named {
  _id: string;
  name: LocalizedText;
  slug?: string;
}

/**
 * One reference list (categories, brands, size guides) as select options.
 * A single page of 100 — the API's maximum — which covers a store's
 * merchandising lists; a picker over thousands would need search instead.
 */
export function useCatalogOptions<TItem extends Named>(
  endpoint: Endpoint<{ query: { limit?: number; [key: string]: unknown }; returnType: PaginatedResponse<TItem> }>,
  options: { exclude?: string; none?: string } = {},
) {
  const query = useRequesterQuery({ endpoint, options: { query: { limit: 100 } } });
  const { exclude, none } = options;
  const items = useMemo(() => {
    const list = (query.data?.data ?? []).filter((item) => item._id !== exclude).map((item) => ({ value: item._id, label: displayName(item.name) || item.slug || "Untitled" }));
    return none ? [{ value: NONE, label: none }, ...list] : list;
  }, [query.data, exclude, none]);
  return { options: items, loading: query.isLoading };
}
