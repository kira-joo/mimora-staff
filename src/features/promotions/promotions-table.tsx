"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { RouteButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { Ban, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { deactivatePromotionEndpoint, listPromotionsEndpoint, type Promotion } from "src/api/promotions.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { displayName, LocalizedNameCell } from "src/features/catalog/catalog-display";
import { promotionStatus } from "./promotion-status";
import { PromotionStatusSignal } from "src/features/status/status-signal";

function discountLabel(promotion: Promotion, money: (v: string) => string): string {
  if (promotion.type === "PERCENT") return `${promotion.value ?? "0"}% off`;
  if (promotion.type === "FIXED") return `${money(promotion.value ?? "0")} off`;
  return "Free shipping";
}

export function PromotionsTable() {
  const router = useRouter();
  const can = usePermission();
  const table = useRef<FeatureTableHandle>(null);
  const { money, dateTime } = useStoreFormat();
  const now = new Date();

  return (
    <FeatureTable<Promotion>
      ref={table}
      endpoint={listPromotionsEndpoint}
      entityName="promotions"
      searchable={false}
      defaultLimit={25}
      filters={[
        {
          key: "active",
          header: "Enabled",
          options: [
            { value: "true", label: "Enabled" },
            { value: "false", label: "Disabled" },
          ],
        },
        {
          key: "type",
          header: "Type",
          options: [
            { value: "PERCENT", label: "Percentage off" },
            { value: "FIXED", label: "Fixed amount off" },
            { value: "FREE_SHIPPING", label: "Free shipping" },
          ],
        },
      ]}
      headerActions={
        <RouteButton path={AppRoute.PROMOTION_NEW} permission={AppPermission.PROMOTION.CREATE} leftIcon={Plus}>
          New promotion
        </RouteButton>
      }
      onRowClick={(row) => router.push(AppRoute.PROMOTION(row._id))}
      emptyMessage="No promotions yet"
      emptyDescription="Create a promotion to discount orders by code or automatically."
      rowActions={[
        { label: "Edit", icon: Pencil, hidden: () => !can(AppPermission.PROMOTION.UPDATE), onClick: (row) => router.push(AppRoute.PROMOTION(row._id)) },
        {
          label: "Disable",
          icon: Ban,
          destructive: true,
          hidden: (row) => !row.active || !can(AppPermission.PROMOTION.DELETE),
          confirm: (row) => ({
            title: `Disable ${displayName(row.name) || row.code || "this promotion"}?`,
            description: "Customers can no longer use it. Past orders keep the discount they got, and you can enable it again from its page.",
            confirmLabel: "Disable",
            destructive: true,
          }),
          onClick: async (row) => {
            if (await runAction(() => requester(deactivatePromotionEndpoint, { params: { id: row._id } }), "Promotion disabled")) table.current?.refetch();
          },
        },
      ]}
      columns={[
        { key: "name", header: "Promotion", render: (row) => <LocalizedNameCell name={row.name} /> },
        {
          key: "code",
          header: "Code",
          render: (row) => (row.code ? <span className="st-figure whitespace-nowrap">{row.code}</span> : <span className="text-[var(--st-ink-muted)]">Automatic</span>),
        },
        { key: "discount", header: "Discount", render: (row) => <span className="whitespace-nowrap">{discountLabel(row, money)}</span> },
        {
          key: "status",
          header: "Status",
          render: (row) => <PromotionStatusSignal status={promotionStatus(row, now)} />,
        },
        {
          key: "window",
          header: "Runs",
          render: (row) =>
            row.conditions.startsAt || row.conditions.endsAt ? (
              <span className="whitespace-nowrap text-[13px]">
                {row.conditions.startsAt ? dateTime(row.conditions.startsAt) : "Now"} to {row.conditions.endsAt ? dateTime(row.conditions.endsAt) : "no end"}
              </span>
            ) : (
              <span className="text-[var(--st-ink-muted)]">Always</span>
            ),
        },
        {
          key: "usage",
          header: "Used",
          render: (row) => (
            <span className="st-figure whitespace-nowrap">
              {row.usageCount}
              {row.limits?.totalUses != null ? ` / ${row.limits?.totalUses}` : ""}
            </span>
          ),
        },
      ]}
    />
  );
}
