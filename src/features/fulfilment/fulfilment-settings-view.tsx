"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getFulfilmentSettingsEndpoint } from "src/api/fulfilment-settings.endpoints";
import { CarriersEditor } from "src/features/orders/carriers-editor";
import { FulfilmentSettingsForm } from "./fulfilment-settings-form";

export function FulfilmentSettingsView() {
  const query = useRequesterQuery({ endpoint: getFulfilmentSettingsEndpoint });
  return (
    <QueryState query={query} entityName="fulfilment settings">
      {(settings) => (
        <PageShell title="Fulfilment settings" description="Delivery and pickup switches, dispatch timing, shipping fees, tax and return windows.">
          <FulfilmentSettingsForm key={settings.updatedAt} settings={settings} />
          <CarriersEditor key={`carriers-${settings.updatedAt}`} initial={settings.carriers ?? []} />
        </PageShell>
      )}
    </QueryState>
  );
}
