"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { modalPresentation, useConfirm, useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import Link from "next/link";
import { useEffect } from "react";
import { getProductGroupEndpoint, setProductGroupMembersEndpoint, type ProductGroup } from "src/api/product-groups.endpoints";
import type { Product } from "src/api/products.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { displayName } from "../catalog-display";
import { AssignGroupDialog, type AssignMode } from "./assign-group-dialog";
import { GroupThumb } from "./group-thumb";
import { withoutProduct } from "./group-members";

/**
 * The product page's view of its group: which group, its label there, the other products — and the actions to add it
 * to a group, change its label, move it or take it out. Grouping never changes the product itself.
 */
export function ProductGroupPanel({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const can = usePermission();
  const { openDialog } = useDialog();
  const canEdit = can(AppPermission.PRODUCT_GROUP.UPDATE);

  async function assign(mode: AssignMode) {
    const outcome = await openDialog<typeof AssignGroupDialog, boolean>({ component: AssignGroupDialog, props: { product, mode }, presentation: modalPresentation({ size: "lg" }) }).result;
    if (outcome.status === "resolved") onChanged();
  }

  if (!can(AppPermission.PRODUCT_GROUP.READ_ONE) && !canEdit) return null;
  return (
    <section aria-labelledby="product-group-heading" className="flex flex-col gap-3 rounded-lg border border-[var(--st-line)] bg-[var(--st-surface)] p-4 sm:p-5">
      <h2 id="product-group-heading" className="text-base font-semibold text-[var(--st-ink)]">
        Product group
      </h2>
      {product.group ? (
        <GroupedSummary key={product.group.groupId} product={product} canEdit={canEdit} onAssign={(mode) => void assign(mode)} onChanged={onChanged} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[var(--st-ink-muted)]">Not in a group. Add it to one to offer it beside its other colours or designs on the storefront — it stays its own product.</p>
          {canEdit ? (
            <div>
              <CustomButton variant="outline" onClick={() => void assign("add")}>
                Add to a group
              </CustomButton>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function GroupedSummary({ product, canEdit, onAssign, onChanged }: { product: Product; canEdit: boolean; onAssign: (mode: AssignMode) => void; onChanged: () => void }) {
  const { confirm } = useConfirm();
  const membership = product.group!;
  const query = useRequesterQuery({ endpoint: getProductGroupEndpoint, options: { params: { id: membership.groupId } } });
  const group: ProductGroup | undefined = query.data;
  const { refetch } = query;
  // The product reloads after a change made here; its group's member list (labels, order) must follow it.
  const signature = `${membership.label.en}\u0000${membership.label.ar}\u0000${membership.order}`;
  useEffect(() => {
    void refetch();
  }, [signature, refetch]);

  async function remove() {
    const ok = await confirm({
      title: "Remove from the group?",
      description: "This product stays exactly as it is; it just stops being offered as an alternative to the other products in the group, and they stop appearing on its page.",
      confirmLabel: "Remove from group",
      destructive: true,
    });
    if (!ok) return;
    const done = await runAction(async () => {
      const fresh = await requester(getProductGroupEndpoint, { params: { id: membership.groupId } });
      await requester(setProductGroupMembersEndpoint, { params: { id: fresh._id }, body: { expectedRevision: fresh.revision, members: withoutProduct(fresh, product._id) } });
    }, "Removed from the group");
    if (done) onChanged();
  }

  // Someone deleted (or this role cannot open) the group since the product was loaded: say so, never act on stale data.
  if (query.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--st-line)] p-3 text-[13px]">
        <span>This product’s group could not be loaded — it may have just been deleted.</span>
        <CustomButton variant="outline" onClick={onChanged}>
          Reload product
        </CustomButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-[13px] text-[var(--st-ink-muted)]">Group</dt>
        <dd>
          <Link href={AppRoute.PRODUCT_GROUP(membership.groupId)} className="font-medium text-[var(--st-ink)] underline-offset-4 hover:underline" dir="auto">
            {group ? displayName(group.name) : "Open group"}
          </Link>
        </dd>
        <dt className="text-[13px] text-[var(--st-ink-muted)]">Label</dt>
        <dd className="flex flex-wrap gap-x-3">
          <span dir="ltr">{membership.label.en}</span>
          <span dir="rtl" lang="ar">
            {membership.label.ar}
          </span>
        </dd>
      </dl>
      {group && group.members.length > 1 ? (
        <ul aria-label="Products in this group" className="flex flex-wrap gap-2">
          {group.members.map((member) => (
            <li key={member.productId}>
              <Link
                href={AppRoute.PRODUCT(member.productId)}
                aria-current={member.productId === product._id ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-md border px-2 py-1 text-[13px] ${member.productId === product._id ? "border-[var(--st-ink)] font-medium" : "border-[var(--st-line)]"}`}
              >
                <GroupThumb image={member.image} size={32} />
                <span dir="auto">{displayName(member.label)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <CustomButton variant="outline" onClick={() => onAssign("label")}>
            Change label
          </CustomButton>
          <CustomButton variant="outline" onClick={() => onAssign("move")}>
            Move to another group
          </CustomButton>
          <CustomButton variant="ghost" onClick={() => void remove()}>
            Remove from group
          </CustomButton>
        </div>
      ) : null}
    </div>
  );
}
