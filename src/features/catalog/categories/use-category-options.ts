"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { useMemo } from "react";
import { listCategoriesEndpoint } from "src/api/categories.endpoints";
import { NONE } from "../use-catalog-options";
import { categoryOptions } from "./category-tree";

/**
 * The category tree as select options (see `categoryOptions`): the product form's category picker and the category
 * form's parent picker. One page of 100, the API's maximum, like every catalog reference list.
 */
export function useCategoryOptions(options: { excludeSubtreeOf?: string; none?: string } = {}) {
  const query = useRequesterQuery({ endpoint: listCategoriesEndpoint, options: { query: { limit: 100 } } });
  const { excludeSubtreeOf, none } = options;
  const items = useMemo(() => {
    const list = categoryOptions(query.data?.data ?? [], { excludeSubtreeOf });
    return none ? [{ value: NONE, label: none }, ...list] : list;
  }, [query.data, excludeSubtreeOf, none]);
  return { options: items, loading: query.isLoading };
}
