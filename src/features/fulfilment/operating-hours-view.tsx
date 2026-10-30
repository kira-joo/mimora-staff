"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getOperatingHoursEndpoint } from "src/api/fulfilment-settings.endpoints";
import { OperatingHoursForm } from "./operating-hours-form";

export function OperatingHoursView() {
  const query = useRequesterQuery({ endpoint: getOperatingHoursEndpoint });
  return (
    <QueryState query={query} entityName="operating hours">
      {(hours) => (
        <PageShell title="Operating hours" description="When the store is open, with dated exceptions for holidays and closures.">
          <OperatingHoursForm key={hours.updatedAt} hours={hours} />
        </PageShell>
      )}
    </QueryState>
  );
}
