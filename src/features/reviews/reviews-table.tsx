"use client";

import { createQueryParamSchema, queryParam, requester, useQueryParamsState } from "@kira-joo/frontend-toolkit-core";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { SortOrder } from "@kira-joo/frontend-toolkit-core";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { listReviewsEndpoint, moderateReviewEndpoint, type Review, type ReviewStatus } from "src/api/reviews.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { displayName } from "src/features/catalog/catalog-display";
import { moderationOptions, ratingLabel, rejectConsequence } from "./review-helpers";
import { ReviewStatusSignal } from "src/features/status/status-signal";

type View = ReviewStatus | "ALL";

const TABS: { value: View; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ALL", label: "All" },
];

/** The tab lives in the URL (`?view=`), like every list filter: a link or a reload keeps it. Pending is the default — it is the work. */
const VIEW = createQueryParamSchema({ view: queryParam.enum<View>(["PENDING", "APPROVED", "REJECTED", "ALL"], { defaultValue: "PENDING" }) });

/** A name from the row, linked to its record only for a role that may open it. */
function RecordName({ name, href, canOpen, width }: { name: string; href: string; canOpen: boolean; width: string }) {
  if (!name) return <span className="text-[var(--st-ink-muted)]">—</span>;
  return canOpen ? (
    <Link href={href} dir="auto" className={`block ${width} truncate underline-offset-2 hover:underline`}>
      {name}
    </Link>
  ) : (
    <span dir="auto" className={`block ${width} truncate`}>
      {name}
    </span>
  );
}

/** The moderation queue. Pending first; approve and reject are one PUT each, and rejecting confirms. */
export function ReviewsTable() {
  const can = usePermission();
  const format = useStoreFormat();
  const table = useRef<FeatureTableHandle>(null);
  const [{ view = "PENDING" }, setView] = useQueryParamsState(VIEW);
  const status = view === "ALL" ? "" : view;
  const canModerate = can(AppPermission.REVIEW.UPDATE);

  async function moderate(row: Review, next: "APPROVED" | "REJECTED") {
    if (await runAction(() => requester(moderateReviewEndpoint, { params: { id: row._id }, body: { status: next } }), next === "APPROVED" ? "Review approved" : "Review rejected")) {
      table.current?.refetch();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Review status" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={view === tab.value}
            onClick={() => setView({ view: tab.value })}
            className="min-h-[var(--st-tap-min)] border border-[var(--st-line-strong)] px-4 font-medium aria-pressed:border-[var(--st-ink)] aria-pressed:bg-[var(--st-accent-soft)]"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <FeatureTable<Review, typeof listReviewsEndpoint>
        key={status}
        ref={table}
        endpoint={listReviewsEndpoint}
        entityName="reviews"
        searchable={false}
        query={status ? { status } : {}}
        sortBy="createdAt"
        sortOrder={SortOrder.DESC}
        defaultLimit={25}
        emptyMessage={status === "PENDING" ? "Nothing waiting for review" : "No reviews here"}
        emptyDescription={status === "PENDING" ? "New customer reviews appear here to approve or reject." : undefined}
        rowActions={[
          { label: "Approve", icon: Check, hidden: (row) => !canModerate || !moderationOptions(row.status).approve, onClick: (row) => moderate(row, "APPROVED") },
          {
            label: "Reject",
            icon: X,
            destructive: true,
            hidden: (row) => !canModerate || !moderationOptions(row.status).reject,
            confirm: (row) => ({ title: "Reject this review?", description: rejectConsequence(row.status), confirmLabel: "Reject review", destructive: true }),
            onClick: (row) => moderate(row, "REJECTED"),
          },
        ]}
        columns={[
          {
            key: "review",
            header: "Review",
            render: (row) => (
              <div className="flex min-w-[12rem] max-w-[20rem] flex-col gap-0.5">
                <span className="st-figure font-medium" aria-label={`Rating ${ratingLabel(row)}`}>
                  {ratingLabel(row)}
                  {row.verifiedPurchase ? <span className="ms-2 font-sans text-[13px] font-normal text-[var(--st-ink-muted)]">Verified purchase</span> : null}
                </span>
                {[row.title, row.body].map((text, index) =>
                  text.en || text.ar ? (
                    <div key={index} className={index === 0 ? "font-medium" : "text-[var(--st-ink-muted)]"}>
                      {text.en ? <p dir="auto" className={index ? "line-clamp-3 whitespace-pre-line" : ""}>{text.en}</p> : null}
                      {text.ar ? <p dir="rtl" lang="ar" className={index ? "line-clamp-3 whitespace-pre-line" : ""}>{text.ar}</p> : null}
                    </div>
                  ) : null,
                )}
              </div>
            ),
          },
          {
            key: "product",
            header: "Product",
            render: (row) => <RecordName name={displayName(row.productName)} href={AppRoute.PRODUCT(row.productId)} canOpen={can(AppPermission.PRODUCT.READ_ONE)} width="max-w-[8rem]" />,
          },
          {
            key: "customer",
            header: "Customer",
            render: (row) => <RecordName name={row.customerName} href={AppRoute.CUSTOMER(row.customerId)} canOpen={can(AppPermission.CUSTOMER.READ_ONE)} width="max-w-[7rem]" />,
          },
          {
            key: "createdAt",
            header: "Status",
            sortable: true,
            render: (row) => (
              <div className="flex flex-col">
                <ReviewStatusSignal status={row.status} />
                <span className="text-[13px] text-[var(--st-ink-muted)]">{format.dateTime(row.createdAt)}</span>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

