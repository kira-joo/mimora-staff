"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { BadgeCheck, CircleDashed } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getCustomerEndpoint, type Customer, type CustomerAddress, type CustomerPrivacy } from "src/api/customers.endpoints";
import { listOrdersEndpoint } from "src/api/orders.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { OrderStatusSignal } from "src/features/status/status-signal";
import { TONE_VAR } from "src/features/status/status-vocabulary";
import { CustomerActions } from "./customer-actions";
import { ConsentPanel } from "./consent-panel";

export function CustomerDetailView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getCustomerEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="customer" backRoute={{ path: AppRoute.CUSTOMERS, label: "Customers" }}>
      {({ customer, addresses, marketingConsent, consentEvents, newsletter }) => <CustomerRecord customer={customer} addresses={addresses} privacy={{ marketingConsent, consentEvents, newsletter }} />}
    </QueryState>
  );
}

function Verified({ ok }: { ok: boolean }) {
  const Icon = ok ? BadgeCheck : CircleDashed;
  return (
    <span className="ms-2 inline-flex items-center gap-1 text-[13px] font-medium" style={{ color: TONE_VAR[ok ? "done" : "neutral"] }}>
      <Icon aria-hidden="true" className="size-3.5" />
      {ok ? "Verified" : "Not verified"}
    </span>
  );
}

function CustomerRecord({ customer, addresses, privacy }: { customer: Customer; addresses: CustomerAddress[]; privacy: CustomerPrivacy }) {
  const format = useStoreFormat();
  return (
    <PageShell title={<span dir="auto">{customer.name}</span>} description={`Joined ${format.dateTime(customer.createdAt)}`} backRoute={{ path: AppRoute.CUSTOMERS, label: "Customers" }} actions={<CustomerActions customer={customer} />}>
      {customer.redactedAt ? (
        <p role="status" className="mb-5 border border-[var(--st-line-strong)] bg-[var(--st-surface)] p-4">
          <span className="font-medium">This customer was deleted (redacted) {format.dateTime(customer.redactedAt)}.</span> Their name, phone, email and credentials are gone. Their orders are kept as financial records.
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Contact">
          <dl className="flex flex-col gap-2">
            <Row label="Phone">
              <bdi dir="ltr" className="st-figure">{customer.phone}</bdi>
              <Verified ok={customer.phoneVerified} />
            </Row>
            <Row label="Email">
              {customer.email ? (
                <>
                  <bdi dir="ltr" className="break-all">{customer.email}</bdi>
                  <Verified ok={customer.emailVerified} />
                </>
              ) : (
                "—"
              )}
            </Row>
          </dl>
        </Panel>
        <RecentOrders customerId={customer._id} />
        <Panel title="Marketing consent">
          <ConsentPanel consent={privacy.marketingConsent} events={privacy.consentEvents} newsletter={privacy.newsletter} />
        </Panel>
        <div className="lg:col-span-2">
          <Panel title={`Addresses (${addresses.length})`}>
            {addresses.length === 0 ? <p className="text-[var(--st-ink-muted)]">No saved addresses.</p> : null}
            <ul className="grid gap-3 md:grid-cols-2">
              {addresses.map((address) => (
                <li key={address._id} className="border border-[var(--st-line)] p-3">
                  <p className="font-medium">
                    <span dir="auto">{address.label}</span>
                    {address.isDefault ? <span className="ms-2 text-[13px] font-normal text-[var(--st-ink-muted)]">Default</span> : null}
                  </p>
                  <p dir="auto">{address.recipientName}</p>
                  <p dir="auto">{[address.addressLine1, address.addressLine2].filter(Boolean).join(", ")}</p>
                  <p dir="auto">{[address.city, address.governorate, address.postalCode].filter(Boolean).join(", ")}</p>
                  <bdi dir="ltr" className="st-figure text-[var(--st-ink-muted)]">{address.phone}</bdi>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}

/** The orders API filters by `customerId`, so this lists them here rather than linking to an unfiltered list. */
function RecentOrders({ customerId }: { customerId: string }) {
  const can = usePermission();
  const format = useStoreFormat();
  const allowed = can(AppPermission.ORDER.READ);
  const query = useRequesterQuery({ endpoint: listOrdersEndpoint, options: { query: { customerId, limit: 10, sortBy: "placedAt", sortOrder: "DESC" } }, queryOptions: { enabled: allowed } });
  if (!allowed) return null;
  const orders = query.data?.data ?? [];
  return (
    <Panel title={`Orders (${query.data?.total ?? "…"})`}>
      {query.isError ? <p role="alert" className="text-[var(--st-status-danger)]">Orders couldn&apos;t be loaded.</p> : null}
      {query.data && orders.length === 0 ? <p className="text-[var(--st-ink-muted)]">No orders yet.</p> : null}
      <ul className="flex flex-col">
        {orders.map((order) => (
          <li key={order._id} className="flex min-h-[var(--st-tap-min)] flex-wrap items-center justify-between gap-x-4 border-b border-[var(--st-line)] py-1.5 last:border-0">
            <Link href={AppRoute.ORDER(order._id)} className="st-figure underline-offset-2 hover:underline">
              {order.orderNumber}
            </Link>
            <OrderStatusSignal status={order.status} />
            <span className="st-figure whitespace-nowrap">{format.money(order.total)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border border-[var(--st-line)] bg-[var(--st-surface)] p-5">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--st-ink-muted)]">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
      <dt className="text-[var(--st-ink-muted)]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
