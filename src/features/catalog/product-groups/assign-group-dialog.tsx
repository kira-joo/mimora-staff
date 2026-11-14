"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { FeatureFilterCombobox } from "@kira-joo/frontend-toolkit-tailwind/combobox";
import { DialogBody, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useState } from "react";
import type { LocalizedText } from "src/api/brands.endpoints";
import { createProductGroupEndpoint, getProductGroupEndpoint, listProductGroupsEndpoint, setProductGroupMembersEndpoint, type ProductGroupListItem } from "src/api/product-groups.endpoints";
import type { Product } from "src/api/products.endpoints";
import { runAction } from "src/common/feedback/run-action";
import { groupNameProblem, membershipProblems } from "src/server/catalog/product-group-rules";
import { displayName } from "../catalog-display";
import { LocalizedPair } from "../products/localized-pair";
import { withProduct } from "./group-members";

export type AssignMode = "add" | "move" | "label";

/**
 * Puts ONE product into a group with its label — an existing group (add or move) or a new one created here — or
 * changes its label in its current group. Reads the target group fresh and saves with that revision, so it never
 * overwrites a change someone else just made to the group's other products.
 */
export function AssignGroupDialog({ titleId, descriptionId, resolve, dismiss, product, mode }: DialogContentProps<boolean> & { product: Product; mode: AssignMode }) {
  const currentGroupId = product.group?.groupId;
  const [target, setTarget] = useState<string | undefined>(mode === "label" ? currentGroupId : undefined);
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState<LocalizedText>({ en: "", ar: "" });
  const [label, setLabel] = useState<LocalizedText>(product.group?.label ? { ...product.group.label } : { en: "", ar: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const labelProblem = membershipProblems([{ productId: product._id, label }])[0] ?? null;

  async function submit() {
    if (labelProblem) return setProblem(labelProblem);
    if (creating && groupNameProblem(groupName)) return setProblem(groupNameProblem(groupName));
    if (!creating && !target) return setProblem("Choose a group.");
    setProblem(null);
    setBusy(true);
    const ok = await runAction(async () => {
      const group = creating ? await requester(createProductGroupEndpoint, { body: { name: groupName } }) : await requester(getProductGroupEndpoint, { params: { id: target! } });
      const members = withProduct(group, product._id, label);
      const sameLabelProblem = membershipProblems(members)[0];
      if (sameLabelProblem) throw { message: sameLabelProblem.replace(/^Product \d+/, "This label") };
      await requester(setProductGroupMembersEndpoint, { params: { id: group._id }, body: { expectedRevision: group.revision, members } });
    }, mode === "label" ? "Label saved" : "Added to the group");
    setBusy(false);
    if (ok) resolve(true);
  }

  const title = mode === "label" ? "Change label" : mode === "move" ? "Move to another group" : "Add to a product group";
  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={title}
      description={<span dir="auto">{displayName(product.name)}</span>}
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss} disabled={busy}>
            Cancel
          </CustomButton>
          <CustomButton onClick={() => void submit()} loading={busy} disabled={busy}>
            {mode === "label" ? "Save label" : creating ? "Create group and add" : mode === "move" ? "Move" : "Add to group"}
          </CustomButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {mode === "label" ? null : creating ? (
          <div className="flex flex-col gap-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <LocalizedPair label="New group name" value={groupName} onChange={setGroupName} disabled={busy} />
            </div>
            <div>
              <CustomButton variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
                Choose an existing group instead
              </CustomButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-[var(--st-ink)]">Group</span>
            <FeatureFilterCombobox<ProductGroupListItem, typeof listProductGroupsEndpoint>
              endpoint={listProductGroupsEndpoint}
              query={{ limit: 100 }}
              optionLabel={(group) => `${displayName(group.name)} (${group.memberCount} product${group.memberCount === 1 ? "" : "s"})${group._id === currentGroupId ? " — current" : ""}`}
              optionValue="_id"
              value={target}
              placeholder="Choose a group"
              emptyMessage="No groups yet"
              onChange={(value) => setTarget(typeof value === "string" && value !== currentGroupId ? value : undefined)}
            />
            {mode === "move" ? <p className="text-[13px] text-[var(--st-ink-muted)]">It leaves its current group when it joins the new one.</p> : null}
            <div>
              <CustomButton variant="ghost" onClick={() => setCreating(true)} disabled={busy}>
                Create a new group
              </CustomButton>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-[var(--st-ink)]">Label customers see</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <LocalizedPair label="Label" value={label} onChange={setLabel} disabled={busy} />
          </div>
          <p className="text-[13px] text-[var(--st-ink-muted)]">The colour or design that tells this product apart from the others in the group — e.g. Brown / بني.</p>
        </div>
        {problem ? (
          <p role="alert" className="text-[13px] font-medium text-[var(--st-status-danger)]">
            {problem}
          </p>
        ) : null}
      </div>
    </DialogBody>
  );
}
