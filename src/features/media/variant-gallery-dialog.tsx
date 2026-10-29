"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { DialogBody, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { useState } from "react";
import type { Product } from "src/api/products.endpoints";
import { updateVariantEndpoint, type Variant } from "src/api/variants.endpoints";
import { runAction } from "src/common/feedback/run-action";
import { toggleGalleryPick } from "./image-gallery";

/**
 * Which of the PRODUCT's images belong to this variant (a colour's own photographs). Choosing only from the product's
 * gallery is deliberate: the variant never holds a file the product does not, so removing a product image cannot leave
 * a variant pointing at something deleted. None chosen means the product's whole gallery shows.
 */
export function VariantGalleryDialog({ product, variant, titleId, descriptionId, resolve }: DialogContentProps<boolean> & { product: Product; variant: Variant }) {
  const gallery = product.images ?? [];
  const [picked, setPicked] = useState<ImageAsset[]>((variant.galleryOverride ?? []).filter((own) => gallery.some((image) => image.publicId === own.publicId)));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const ok = await runAction(() => requester(updateVariantEndpoint, { params: { id: variant._id }, body: { galleryOverride: picked } }), `${variant.sku} images saved`);
    setSaving(false);
    if (ok) resolve(true);
  }

  return (
    <DialogBody titleId={titleId} descriptionId={descriptionId} title={<span className="st-figure">{variant.sku}</span>} description="Images for this variant">
      {gallery.length === 0 ? (
        <p className="text-[var(--st-ink-muted)]">The product has no images yet. Add them in the product&apos;s Images section first, then choose which belong to this variant.</p>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[var(--st-ink-muted)]">Tick the images to show for this variant. With none ticked, the product&apos;s whole gallery shows.</legend>
          <ul className="grid grid-cols-3 gap-3">
            {gallery.map((image, index) => {
              const checked = picked.some((pick) => pick.publicId === image.publicId);
              return (
                <li key={image.publicId}>
                  <label className={`flex cursor-pointer flex-col gap-1 rounded-md border p-1.5 ${checked ? "border-[var(--st-ink)]" : "border-[var(--st-line)]"} focus-within:outline focus-within:outline-2 focus-within:outline-offset-2`}>
                    <span className="flex aspect-square items-center justify-center overflow-hidden rounded bg-[var(--st-canvas)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.secureUrl} alt="" className="size-full object-contain" />
                    </span>
                    <span className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={checked} onChange={() => setPicked(toggleGalleryPick(gallery, picked, image))} />
                      Image {index + 1}
                      {index === 0 ? <span className="text-[var(--st-ink-muted)]">(primary)</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <CustomButton type="button" variant="ghost" onClick={() => resolve(false)}>
          Cancel
        </CustomButton>
        <CustomButton type="button" disabled={saving || gallery.length === 0} onClick={() => void save()}>
          {saving ? "Saving…" : "Save images"}
        </CustomButton>
      </div>
    </DialogBody>
  );
}
