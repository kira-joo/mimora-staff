"use client";

import type { Endpoint, EndpointSchema } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useEndpointUpload } from "@kira-joo/frontend-toolkit-tailwind/upload";
import type { ImageAsset, UploadPolicy } from "@kira-joo/toolkit-common";
import { ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { acceptFor, describeDimensions, precheckImage } from "./image-gallery";
import { uploadErrorMessage } from "./upload-error-message";

/**
 * Picks a file, checks it against the policy (type and size, here; dimensions, on the server), uploads it to the given
 * endpoint at once, and hands the stored `ImageAsset` to the form. Nothing is saved on the record until the form's own
 * save. A native file input behind a button, so it is reachable and operable by keyboard; the server's refusal (wrong
 * dimensions, storage not configured) is shown in place.
 */
export function ImageUploadField({
  label,
  description,
  value,
  onChange,
  uploadEndpoint,
  uploadBody,
  policy,
  disabled,
  previewClassName = "size-24",
}: {
  label: string;
  description?: string;
  value: ImageAsset | null | undefined;
  onChange: (next: ImageAsset | null) => void;
  uploadEndpoint: Endpoint<EndpointSchema & { body: { slot?: string }; returnType: ImageAsset }>;
  uploadBody?: { slot?: string };
  policy: UploadPolicy;
  disabled?: boolean;
  previewClassName?: string;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string>();
  const { status, upload } = useEndpointUpload<typeof uploadEndpoint, ImageAsset>({ uploadEndpoint, fileFieldName: "file", uploadBody });
  const uploading = status === "uploading";

  async function pick(file: File | undefined) {
    if (!file) return;
    const refused = precheckImage(file, policy);
    if (refused) return setProblem(refused);
    setProblem(undefined);
    try {
      onChange(await upload(file));
    } catch (error) {
      setProblem(uploadErrorMessage(error, "The upload failed. Try again."));
    }
  }

  const limits = [`${policy.allowedFormats.filter((format) => format !== "jpeg").map((format) => format.toUpperCase()).join(", ")}`, `up to ${(policy.maxBytes / (1024 * 1024)).toFixed(0)} MB`, describeDimensions(policy)].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-2">
      <span id={`${inputId}-label`} className="font-medium text-[var(--st-ink)]">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-4">
        <div className={`${previewClassName} flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--st-line)] bg-[var(--st-canvas)]`}>
          {value?.secureUrl ? (
            // A stored asset on the CDN: a plain img, sized by its box. The alt names the field; the asset has no alt text of its own.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.secureUrl} alt={`${label} preview`} className="size-full object-contain" />
          ) : (
            <ImagePlus aria-hidden="true" className="size-6 text-[var(--st-ink-muted)]" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            id={inputId}
            type="file"
            accept={acceptFor(policy)}
            className="sr-only"
            tabIndex={-1}
            aria-labelledby={`${inputId}-label`}
            disabled={disabled || uploading}
            onChange={(event) => {
              void pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {disabled ? null : (
            <>
              <CustomButton type="button" variant="outline" leftIcon={value ? RefreshCw : ImagePlus} disabled={uploading} onClick={() => input.current?.click()} aria-describedby={`${inputId}-hint`}>
                {uploading ? "Uploading…" : value ? "Replace" : "Upload"}
              </CustomButton>
              {value ? (
                <CustomButton type="button" variant="ghost" className="text-[var(--st-status-danger)]" disabled={uploading} onClick={() => onChange(null)}>
                  <Trash2 aria-hidden="true" className="size-4" />
                  Remove
                </CustomButton>
              ) : null}
            </>
          )}
        </div>
      </div>
      <p id={`${inputId}-hint`} className="text-[13px] text-[var(--st-ink-muted)]">
        {description ? `${description} ` : ""}
        {limits}
      </p>
      {problem ? (
        <p role="alert" className="text-[13px] font-medium text-[var(--st-status-danger)]">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
