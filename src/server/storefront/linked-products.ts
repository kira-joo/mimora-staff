import type { ImageAsset, LocalizedString } from "@kira-joo/toolkit-common";
import type mongoose from "mongoose";

/** One alternative on a product page: another product in the same group, or the one being viewed. */
export interface LinkedProductItem {
  slug: string;
  name: LocalizedString;
  /** The colour or design name staff gave it in the group ("Brown", "بني"). */
  label: LocalizedString;
  image?: ImageAsset;
  /** The product this page is for. */
  current: boolean;
}

export interface LinkedProductsView {
  items: LinkedProductItem[];
}

export interface GroupSibling {
  _id: mongoose.Types.ObjectId;
  slug: string;
  name: LocalizedString;
  images?: ImageAsset[];
  listing?: { primaryImage?: ImageAsset };
  group?: { label: LocalizedString; order: number };
}

/**
 * The storefront's view of a product's group: every member it was given (the caller passes PUBLISHED members only,
 * already in group order), with the current one marked. `null` when there is nothing to switch to — no group, or no
 * other published member — so a product page shows no switcher rather than a lone tile.
 */
export function linkedProductsView(currentId: mongoose.Types.ObjectId, siblings: GroupSibling[]): LinkedProductsView | null {
  if (siblings.length < 2 || !siblings.some((sibling) => sibling._id.equals(currentId))) return null;
  return {
    items: siblings.map((sibling) => ({
      slug: sibling.slug,
      name: sibling.name,
      label: sibling.group?.label ?? sibling.name,
      image: sibling.images?.[0] ?? sibling.listing?.primaryImage,
      current: sibling._id.equals(currentId),
    })),
  };
}
