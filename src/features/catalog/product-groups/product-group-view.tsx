"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { useConfirm } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomButton, PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LocalizedText } from "src/api/brands.endpoints";
import { deleteProductGroupEndpoint, getProductGroupEndpoint, renameProductGroupEndpoint, type ProductGroup } from "src/api/product-groups.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { groupNameProblem } from "src/server/catalog/product-group-rules";
import { displayName } from "../catalog-display";
import { LocalizedPair } from "../products/localized-pair";
import { MembersEditor } from "./members-editor";

const BACK = { path: AppRoute.PRODUCT_GROUPS, label: "Product groups" };

export function ProductGroupView({ id }: { id: string }) {
  const router = useRouter();
  const can = usePermission();
  const { confirm } = useConfirm();
  const query = useRequesterQuery({ endpoint: getProductGroupEndpoint, options: { params: { id } } });
  const reload = () => void query.refetch();

  async function remove(group: ProductGroup) {
    const ok = await confirm({
      title: `Delete ${displayName(group.name)}?`,
      description: `Its ${group.members.length} product${group.members.length === 1 ? "" : "s"} are kept exactly as they are — prices, stock, images and pages — and simply stop being offered as alternatives to each other.`,
      confirmLabel: "Delete group",
      destructive: true,
    });
    if (ok && (await runAction(() => requester(deleteProductGroupEndpoint, { params: { id: group._id } }), "Group deleted"))) router.push(AppRoute.PRODUCT_GROUPS);
  }

  return (
    <QueryState query={query} entityName="product group" backRoute={BACK}>
      {(group) => (
        <PageShell
          title={<span dir="auto">{displayName(group.name)}</span>}
          description={`${group.members.length} product${group.members.length === 1 ? "" : "s"}`}
          backRoute={BACK}
          actions={
            can(AppPermission.PRODUCT_GROUP.DELETE) ? (
              <CustomButton variant="outline" leftIcon={Trash2} onClick={() => void remove(group)}>
                Delete group
              </CustomButton>
            ) : null
          }
        >
          <div className="flex flex-col gap-6">
            <GroupNameEditor key={`${group.name.en}\u0000${group.name.ar}`} group={group} canEdit={can(AppPermission.PRODUCT_GROUP.UPDATE)} onSaved={reload} />
            {/* Keyed on the revision: a save (or a reload after a conflict) starts the editor from what is stored. */}
            <MembersEditor key={group.revision} group={group} canEdit={can(AppPermission.PRODUCT_GROUP.UPDATE)} onSaved={reload} onReload={reload} />
          </div>
        </PageShell>
      )}
    </QueryState>
  );
}

function GroupNameEditor({ group, canEdit, onSaved }: { group: ProductGroup; canEdit: boolean; onSaved: () => void }) {
  const [name, setName] = useState<LocalizedText>({ ...group.name });
  const [busy, setBusy] = useState(false);
  const problem = groupNameProblem(name);
  const dirty = name.en !== group.name.en || name.ar !== group.name.ar;

  async function save() {
    if (problem) return;
    setBusy(true);
    if (await runAction(() => requester(renameProductGroupEndpoint, { params: { id: group._id }, body: { name } }), "Name saved")) onSaved();
    setBusy(false);
  }

  return (
    <section aria-labelledby="group-name-heading" className="flex flex-col gap-3 rounded-lg border border-[var(--st-line)] bg-[var(--st-surface)] p-4 sm:p-5">
      <h2 id="group-name-heading" className="text-base font-semibold text-[var(--st-ink)]">
        Group name
      </h2>
      <p className="text-[13px] text-[var(--st-ink-muted)]">Only staff see it. Customers see each product’s label.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <LocalizedPair label="Group name" value={name} onChange={setName} disabled={!canEdit || busy} />
      </div>
      {dirty && problem ? (
        <p role="alert" className="text-[13px] font-medium text-[var(--st-status-danger)]">
          {problem}
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <CustomButton variant="outline" onClick={() => void save()} loading={busy} disabled={busy || !dirty || Boolean(problem)}>
            Save name
          </CustomButton>
        </div>
      ) : null}
    </section>
  );
}
