"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useEndpointUpload } from "@kira-joo/frontend-toolkit-tailwind/upload";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from "lucide-react";
import { useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { uploadProductImageEndpoint } from "src/api/media.endpoints";
import { updateProductEndpoint, type Product } from "src/api/products.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { usePermission } from "src/features/auth/use-permission";
import { catalogMediaSpec, MAX_PRODUCT_IMAGES } from "src/server/admin/media/media-targets";
import { acceptFor, describeDimensions, moveImage, precheckImage, removeImageAt, sameGallery } from "./image-gallery";
import { uploadErrorMessage } from "./upload-error-message";

const POLICY = catalogMediaSpec("product").policy;

/**
 * A product's gallery: upload several at once, put them in order (the first is the primary image on every listing),
 * remove. Edits are held — by the product page, not here — until "Save images" or "Save product", so a mis-click
 * costs nothing; either save sends the whole ordered gallery. Holding them on the page is what lets the product form's
 * own save include them: a gallery kept only in here was dropped whenever the page reloaded after "Save product".
 * Removing an image also takes it out of any variant's picked images, and the stored file is deleted once the save has
 * committed (the server's doing — it never deletes anything that is still shown elsewhere).
 *
 * No alt text field: the stored image carries none, so the storefront names images by the product. That is a schema
 * limit, not a choice made here.
 */
export function ProductImageManager({
  product,
  images,
  onImagesChange: setImages,
  onChanged,
}: {
  product: Product;
  /** The gallery as edited and not yet saved — owned by the product page. */
  images: ImageAsset[];
  onImagesChange: Dispatch<SetStateAction<ImageAsset[]>>;
  onChanged: () => void;
}) {
  const can = usePermission();
  const canEdit = can(AppPermission.PRODUCT.UPDATE);
  const saved = product.images ?? [];
  const [problems, setProblems] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const { upload } = useEndpointUpload<typeof uploadProductImageEndpoint, ImageAsset>({ uploadEndpoint: uploadProductImageEndpoint, fileFieldName: "file" });
  const dirty = !sameGallery(images, saved);
  const room = MAX_PRODUCT_IMAGES - images.length;

  async function addFiles(files: File[]) {
    const found: string[] = [];
    const accepted: File[] = [];
    for (const file of files) {
      const refused = precheckImage(file, POLICY);
      if (refused) found.push(refused);
      else if (accepted.length >= room) found.push(`"${file.name}" was not added — a product holds at most ${MAX_PRODUCT_IMAGES} images.`);
      else accepted.push(file);
    }
    setProblems(found);
    setUploading(true);
    const added: ImageAsset[] = [];
    // One at a time: the order they were chosen in is the order they appear in.
    for (const file of accepted) {
      try {
        added.push(await upload(file));
      } catch (error) {
        found.push(`${file.name}: ${uploadErrorMessage(error, "the upload failed.")}`);
      }
    }
    setProblems([...found]);
    setImages((current) => [...current, ...added]);
    setUploading(false);
  }

  async function save() {
    setSaving(true);
    const ok = await runAction(() => requester(updateProductEndpoint, { params: { id: product._id }, body: { images } }), "Images saved");
    setSaving(false);
    if (ok) onChanged();
  }

  return (
    <section aria-labelledby={`${inputId}-heading`} className="rounded-md border border-[var(--st-line)] bg-[var(--st-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--st-line)] px-4 py-3">
        <h2 id={`${inputId}-heading`} className="text-[13px] font-semibold uppercase tracking-wide text-[var(--st-ink-muted)]">
          Images ({images.length})
        </h2>
        {canEdit ? (
          <>
            <input
              ref={input}
              id={inputId}
              type="file"
              multiple
              accept={acceptFor(POLICY)}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose images to add"
              onChange={(event) => {
                void addFiles([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            <CustomButton type="button" leftIcon={ImagePlus} disabled={uploading || room <= 0} onClick={() => input.current?.click()}>
              {uploading ? "Uploading…" : "Add images"}
            </CustomButton>
          </>
        ) : null}
      </header>

      {images.length === 0 ? (
        <p className="px-4 py-6 text-[var(--st-ink-muted)]">No images yet. Customers see a blank tile until one is added.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((image, index) => (
            <li key={image.publicId} className="flex flex-col gap-2 rounded-md border border-[var(--st-line)] p-2">
              <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded bg-[var(--st-canvas)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.secureUrl} alt={`Image ${index + 1} of ${images.length}`} className="size-full object-contain" />
                {index === 0 ? <span className="absolute start-1 top-1 rounded bg-[var(--st-ink)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--st-surface)]">Primary</span> : null}
              </div>
              {canEdit ? (
                <div className="flex items-center justify-between">
                  <div className="flex">
                    <CustomButton type="button" variant="ghost" size="icon" aria-label={`Move image ${index + 1} earlier`} disabled={index === 0} onClick={() => setImages(moveImage(images, index, index - 1))}>
                      <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
                    </CustomButton>
                    <CustomButton type="button" variant="ghost" size="icon" aria-label={`Move image ${index + 1} later`} disabled={index === images.length - 1} onClick={() => setImages(moveImage(images, index, index + 1))}>
                      <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
                    </CustomButton>
                  </div>
                  <CustomButton type="button" variant="ghost" size="icon" aria-label={`Remove image ${index + 1}`} onClick={() => setImages(removeImageAt(images, index))}>
                    <Trash2 aria-hidden="true" className="size-4 text-[var(--st-status-danger)]" />
                  </CustomButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--st-line)] px-4 py-3">
        <p className="text-[13px] text-[var(--st-ink-muted)]">
          {[POLICY.allowedFormats.filter((f) => f !== "jpeg").map((f) => f.toUpperCase()).join(", "), `up to ${POLICY.maxBytes / (1024 * 1024)} MB each`, describeDimensions(POLICY)].filter(Boolean).join(" · ")}
        </p>
        {canEdit ? (
          <div className="flex gap-2">
            <CustomButton type="button" variant="ghost" disabled={!dirty || saving || uploading} onClick={() => setImages(saved)}>
              Discard changes
            </CustomButton>
            <CustomButton type="button" disabled={!dirty || saving || uploading} onClick={() => void save()}>
              {saving ? "Saving…" : "Save images"}
            </CustomButton>
          </div>
        ) : null}
      </div>

      {problems.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-1 border-t border-[var(--st-line)] px-4 py-3 text-[13px] font-medium text-[var(--st-status-danger)]">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
