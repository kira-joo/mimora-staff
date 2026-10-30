"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getPickupLocationEndpoint, updatePickupLocationEndpoint } from "src/api/pickup-locations.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { PickupLocationForm } from "./pickup-location-form";

export function PickupLocationEditView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getPickupLocationEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="pickup location" backRoute={{ path: AppRoute.PICKUP_LOCATIONS, label: "Pickup locations" }}>
      {(location) => (
        <PageShell
          title={<span dir="auto">{location.name.en || location.name.ar || "Untitled location"}</span>}
          backRoute={{ path: AppRoute.PICKUP_LOCATIONS, label: "Pickup locations" }}
        >
          <PickupLocationForm key={location.updatedAt} endpoint={updatePickupLocationEndpoint} oldData={location} />
        </PageShell>
      )}
    </QueryState>
  );
}
