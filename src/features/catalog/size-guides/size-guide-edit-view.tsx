"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getSizeGuideEndpoint, updateSizeGuideEndpoint } from "src/api/size-guides.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { displayName } from "../catalog-display";
import { SizeGuideForm } from "./size-guide-form";

export function SizeGuideEditView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getSizeGuideEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="size guide" backRoute={{ path: AppRoute.SIZE_GUIDES, label: "Size guides" }}>
      {(guide) => (
        <PageShell title={<span dir="auto">{displayName(guide.name)}</span>} backRoute={{ path: AppRoute.SIZE_GUIDES, label: "Size guides" }}>
          <SizeGuideForm key={guide.updatedAt} endpoint={updateSizeGuideEndpoint} oldData={guide} />
        </PageShell>
      )}
    </QueryState>
  );
}
