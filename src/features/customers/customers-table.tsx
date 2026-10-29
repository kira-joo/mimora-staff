"use client";

import { FeatureTable } from "@kira-joo/frontend-toolkit-tailwind/table";
import { useRouter } from "next/navigation";
import { listCustomersEndpoint, type Customer } from "src/api/customers.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";

/** Read-only customer list; search matches name, phone or email on the server. */
export function CustomersTable() {
  const router = useRouter();
  const format = useStoreFormat();
  return (
    <FeatureTable<Customer>
      endpoint={listCustomersEndpoint}
      entityName="customers"
      searchPlaceholder="Search name, phone or email"
      defaultLimit={25}
      onRowClick={(row) => router.push(AppRoute.CUSTOMER(row._id))}
      emptyMessage="No customers found"
      emptyDescription="Customers appear here once they register on the storefront."
      columns={[
        {
          key: "name",
          header: "Customer",
          render: (row) => (
            <span dir="auto" className="block max-w-[18rem] truncate font-medium">
              {row.name}
            </span>
          ),
        },
        { key: "phone", header: "Phone", render: (row) => <bdi dir="ltr" className="st-figure whitespace-nowrap">{row.phone}</bdi> },
        { key: "email", header: "Email", render: (row) => (row.email ? <bdi dir="ltr" className="block max-w-[18rem] truncate">{row.email}</bdi> : <span className="text-[var(--st-ink-muted)]">—</span>) },
        { key: "createdAt", header: "Joined", sortable: true, render: (row) => <span className="whitespace-nowrap">{format.dateTime(row.createdAt)}</span> },
      ]}
    />
  );
}
