"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { DialogBody, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useState } from "react";
import type { LocalizedText } from "src/api/brands.endpoints";
import { createProductGroupEndpoint, type ProductGroup } from "src/api/product-groups.endpoints";
import { runAction } from "src/common/feedback/run-action";
import { groupNameProblem } from "src/server/catalog/product-group-rules";
import { LocalizedPair } from "../products/localized-pair";

/** Names a new, empty group. Resolves with the created group; products are added on its page or from a product. */
export function CreateGroupDialog({ titleId, descriptionId, resolve, dismiss, initialName }: DialogContentProps<ProductGroup> & { initialName?: LocalizedText }) {
  const [name, setName] = useState<LocalizedText>(initialName ?? { en: "", ar: "" });
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const problem = groupNameProblem(name);

  async function submit() {
    setTouched(true);
    if (problem) return;
    setBusy(true);
    let created: ProductGroup | undefined;
    const ok = await runAction(async () => {
      created = await requester(createProductGroupEndpoint, { body: { name } });
    }, "Group created");
    setBusy(false);
    if (ok && created) resolve(created);
  }

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title="New product group"
      description="Groups separate products that are versions of one item — the same slipper in several colours. Each stays its own product with its own page, price and stock."
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss} disabled={busy}>
            Cancel
          </CustomButton>
          <CustomButton onClick={() => void submit()} loading={busy} disabled={busy}>
            Create group
          </CustomButton>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <LocalizedPair label="Group name" value={name} onChange={setName} disabled={busy} />
        <p className="text-[13px] text-[var(--st-ink-muted)] sm:col-span-2">Only staff see the group name. Customers see each product’s own label (Brown, Pink…).</p>
        {touched && problem ? (
          <p role="alert" className="text-[13px] font-medium text-[var(--st-status-danger)] sm:col-span-2">
            {problem}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </DialogBody>
  );
}
