import type { ImageAsset } from "@kira-joo/toolkit-common";
import { ImageOff } from "lucide-react";

/** A small square of a product's first image, so staff recognise a product at a glance. */
export function GroupThumb({ image, size = 48 }: { image?: ImageAsset; size?: number }) {
  return (
    <span className="flex flex-none items-center justify-center overflow-hidden rounded-md border border-[var(--st-line)] bg-[var(--st-surface)]" style={{ width: size, height: size }}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small staff thumbnail, like the other staff previews
        <img src={image.secureUrl} alt="" className="size-full object-cover" />
      ) : (
        <ImageOff aria-hidden="true" className="size-4 text-[var(--st-ink-muted)]" />
      )}
    </span>
  );
}
