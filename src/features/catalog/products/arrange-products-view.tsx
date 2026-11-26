"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { useConfirm } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomSelect } from "@kira-joo/frontend-toolkit-tailwind/select";
import { useCallback, useEffect, useState } from "react";
import { listCategoriesEndpoint } from "src/api/categories.endpoints";
import { listCollectionsEndpoint } from "src/api/collections.endpoints";
import { listProductOrderEndpoint } from "src/api/products.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { useCatalogOptions } from "../use-catalog-options";
import { ArrangeProductsList } from "./arrange-products-list";

const BACK = { path: AppRoute.PRODUCTS, label: "Products" };

type ScopeKind = "all" | "category" | "collection";
interface Scope {
  kind: ScopeKind;
  /** The chosen category or collection; empty until one is picked. */
  id: string;
}

const KIND_OPTIONS: Array<{ value: ScopeKind; label: string }> = [
  { value: "all", label: "All products" },
  { value: "category", label: "A category" },
  { value: "collection", label: "A collection" },
];

/**
 * Arrange products: the order the storefront lists them in by default. Arranging a category or a collection reorders
 * only those products relative to each other — every other product keeps its place.
 */
export function ArrangeProductsView() {
  const { confirm } = useConfirm();
  const categories = useCatalogOptions(listCategoriesEndpoint);
  const collections = useCatalogOptions(listCollectionsEndpoint);
  const [scope, setScope] = useState<Scope>({ kind: "all", id: "" });
  const [dirty, setDirty] = useState(false);

  // Leaving the page with an arrangement in progress would lose it.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function changeScope(next: Scope) {
    if (next.kind === scope.kind && next.id === scope.id) return;
    if (dirty && !(await confirm({ title: "Discard unsaved changes?", description: "You have rearranged products without saving. Switching what you are arranging discards that.", confirmLabel: "Discard and switch", cancelLabel: "Keep arranging", destructive: true }))) return;
    setScope(next);
  }

  const picker = scope.kind === "category" ? categories : scope.kind === "collection" ? collections : undefined;
  const ready = scope.kind === "all" || scope.id !== "";

  return (
    <PageShell title="Arrange products" description="Set the order the storefront lists products in. Newly added products go to the end." backRoute={BACK}>
      <div className="flex flex-col gap-4">
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <CustomSelect<ScopeKind> label="Arrange" options={KIND_OPTIONS} value={scope.kind} onChange={(value) => void changeScope({ kind: value as ScopeKind, id: "" })} />
          {picker ? (
            <CustomSelect<string>
              label={scope.kind === "category" ? "Category" : "Collection"}
              placeholder={picker.loading ? "Loading…" : scope.kind === "category" ? "Choose a category" : "Choose a collection"}
              options={picker.options}
              value={scope.id}
              onChange={(value) => void changeScope({ kind: scope.kind, id: value as string })}
            />
          ) : null}
        </div>

        {ready ? (
          <ScopedList key={`${scope.kind}:${scope.id}`} scope={scope} onDirtyChange={setDirty} />
        ) : (
          <p className="text-[var(--st-ink-muted)]">Choose {scope.kind === "category" ? "a category" : "a collection"} to arrange its products.</p>
        )}
      </div>
    </PageShell>
  );
}

function ScopedList({ scope, onDirtyChange }: { scope: Scope; onDirtyChange: (dirty: boolean) => void }) {
  const query = useRequesterQuery({
    endpoint: listProductOrderEndpoint,
    options: { query: scope.kind === "category" ? { categoryId: scope.id } : scope.kind === "collection" ? { collectionId: scope.id } : {} },
    // An arrangement in progress must never be replaced by a background refetch; reloads are explicit (after a save, or "Reload list").
    queryOptions: { refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false, gcTime: 0 },
  });
  const stable = useCallback((dirty: boolean) => onDirtyChange(dirty), [onDirtyChange]);

  return (
    <QueryState query={query} entityName="products" backRoute={BACK}>
      {(products) => (
        <ArrangeProductsList
          // Rebuilt from the server's order whenever a load completes (first load, after a save, "Reload list").
          key={query.dataUpdatedAt}
          products={products}
          scope={scope.kind === "category" ? { categoryId: scope.id } : scope.kind === "collection" ? { collectionId: scope.id } : {}}
          scopeNote={scope.kind === "category" ? "Includes products in its sub-categories. Products elsewhere keep their positions." : scope.kind === "collection" ? "Products outside this collection keep their positions." : undefined}
          onDirtyChange={stable}
          onReload={() => void query.refetch()}
        />
      )}
    </QueryState>
  );
}
