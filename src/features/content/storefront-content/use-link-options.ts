"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { useMemo } from "react";
import { listCategoriesEndpoint } from "src/api/categories.endpoints";
import { listCollectionsEndpoint } from "src/api/collections.endpoints";
import { listPagesEndpoint } from "src/api/pages.endpoints";
import { displayName } from "src/features/catalog/catalog-display";
import { encodeTarget } from "./storefront-content-values";

export interface PickerOption {
  value: string;
  label: string;
}

export interface LinkOptions {
  /** Categories, collections and pages in one list — for a link: values are `kind:id`. */
  links: PickerOption[];
  collections: PickerOption[];
  categories: PickerOption[];
  loading: boolean;
}

const UNPUBLISHED = " (unpublished)";

/**
 * What a link, a collection or a category can point at, from the three admin lists (a page of 100 each, the API's
 * maximum — enough for a store's merchandising set). Unpublished items are listed but marked: a draft may point at
 * one, and the preview is what says it cannot go live that way.
 */
export function useLinkOptions(): LinkOptions {
  const categories = useRequesterQuery({ endpoint: listCategoriesEndpoint, options: { query: { limit: 100 } } });
  const collections = useRequesterQuery({ endpoint: listCollectionsEndpoint, options: { query: { limit: 100 } } });
  const pages = useRequesterQuery({ endpoint: listPagesEndpoint, options: { query: { limit: 100 } } });

  return useMemo(() => {
    const label = (name: string | undefined, fallback: string | undefined, published: boolean) => `${name || fallback || "Untitled"}${published ? "" : UNPUBLISHED}`;
    const categoryOptions = (categories.data?.data ?? []).map((item) => ({ value: item._id, label: label(displayName(item.name), item.slug, item.published) }));
    const collectionOptions = (collections.data?.data ?? []).map((item) => ({ value: item._id, label: label(displayName(item.name), item.slug, item.published) }));
    const pageOptions = (pages.data?.data ?? []).map((item) => ({ id: item._id, label: label(displayName(item.title), item.slug, item.published) }));
    return {
      categories: categoryOptions,
      collections: collectionOptions,
      links: [
        ...categoryOptions.map((o) => ({ value: encodeTarget({ kind: "category", id: o.value }), label: `Category · ${o.label}` })),
        ...collectionOptions.map((o) => ({ value: encodeTarget({ kind: "collection", id: o.value }), label: `Collection · ${o.label}` })),
        ...pageOptions.map((o) => ({ value: encodeTarget({ kind: "page", id: o.id }), label: `Page · ${o.label}` })),
      ],
      loading: categories.isLoading || collections.isLoading || pages.isLoading,
    };
  }, [categories.data, collections.data, pages.data, categories.isLoading, collections.isLoading, pages.isLoading]);
}
