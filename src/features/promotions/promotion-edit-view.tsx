"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getPromotionEndpoint, updatePromotionEndpoint } from "src/api/promotions.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { displayName } from "src/features/catalog/catalog-display";
import { PromotionForm } from "./promotion-form";

/** The form is keyed by `updatedAt`: it takes its defaults once on mount, and a cached copy renders before the refetch lands, so fresh data must remount it. */
export function PromotionEditView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getPromotionEndpoint, options: { params: { id } } });
  const back = { path: AppRoute.PROMOTIONS, label: "Promotions" };
  return (
    <QueryState query={query} entityName="promotion" backRoute={back}>
      {(promotion) => (
        <PageShell title={<span dir="auto">{displayName(promotion.name) || promotion.code || "Promotion"}</span>} backRoute={back}>
          <PromotionForm key={promotion.updatedAt} endpoint={updatePromotionEndpoint} oldData={promotion} />
        </PageShell>
      )}
    </QueryState>
  );
}
