import type { ImageAsset, LocalizedString } from "@kira-joo/toolkit-common";
import type mongoose from "mongoose";
import type { ProductContentEntry } from "../catalog/product.schema";

/** The most gallery images shown per included product on a box's page. */
export const MAX_INCLUDED_IMAGES = 6;

/** One product inside a box, as a product page shows it — live data, resolved at read time. */
export interface IncludedProductItem {
  slug: string;
  name: LocalizedString;
  quantity: number;
  /** Up to {@link MAX_INCLUDED_IMAGES} gallery images, else the listing image; empty only if the product has neither. */
  images: ImageAsset[];
}

export interface IncludedProductSource {
  _id: mongoose.Types.ObjectId;
  slug: string;
  name: LocalizedString;
  images?: ImageAsset[];
  listing?: { primaryImage?: ImageAsset };
}

/**
 * The storefront's view of a product's contents: each stored entry, in stored order, joined to its live product.
 * The caller passes PUBLISHED products only; an entry whose product is not among them (draft, archived, gone) is
 * omitted, since its page would 404 and it may be unreleased. Empty when there is nothing to show.
 */
export function includedProductsView(contents: ProductContentEntry[] | undefined, published: IncludedProductSource[]): IncludedProductItem[] {
  if (!contents || contents.length === 0) return [];
  const byId = new Map(published.map((product) => [product._id.toString(), product]));
  return contents.flatMap((entry) => {
    const product = byId.get(entry.productId.toString());
    if (!product) return [];
    const gallery = product.images ?? [];
    const images = gallery.length > 0 ? gallery.slice(0, MAX_INCLUDED_IMAGES) : product.listing?.primaryImage ? [product.listing.primaryImage] : [];
    return [{ slug: product.slug, name: product.name, quantity: entry.quantity, images }];
  });
}
