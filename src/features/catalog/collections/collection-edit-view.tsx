"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getCollectionEndpoint, updateCollectionEndpoint } from "src/api/collections.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { displayName } from "../catalog-display";
import { CollectionForm } from "./collection-form";

export function CollectionEditView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getCollectionEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="collection" backRoute={{ path: AppRoute.COLLECTIONS, label: "Collections" }}>
      {(collection) => (
        <PageShell title={<span dir="auto">{displayName(collection.name)}</span>} backRoute={{ path: AppRoute.COLLECTIONS, label: "Collections" }}>
          <CollectionForm key={collection.updatedAt} endpoint={updateCollectionEndpoint} oldData={collection} />
        </PageShell>
      )}
    </QueryState>
  );
}
