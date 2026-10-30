"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getDeliveryZoneEndpoint, updateDeliveryZoneEndpoint } from "src/api/delivery-zones.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { DeliveryZoneForm } from "./delivery-zone-form";

export function DeliveryZoneEditView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getDeliveryZoneEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="delivery zone" backRoute={{ path: AppRoute.DELIVERY_ZONES, label: "Delivery zones" }}>
      {(zone) => (
        <PageShell
          title={<span dir="auto">{zone.name.en || zone.name.ar || "Untitled zone"}</span>}
          backRoute={{ path: AppRoute.DELIVERY_ZONES, label: "Delivery zones" }}
        >
          <DeliveryZoneForm key={zone.updatedAt} endpoint={updateDeliveryZoneEndpoint} oldData={zone} />
        </PageShell>
      )}
    </QueryState>
  );
}
