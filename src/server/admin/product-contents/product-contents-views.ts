import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { resolveSession } from "@kira-joo/backend-toolkit-mongoose";
import type { ImageAsset, LocalizedString } from "@kira-joo/toolkit-common";
import { ProductModel } from "../../catalog/product.schema";

export interface ProductContentItemView {
  productId: string;
  name: LocalizedString;
  slug: string;
  lifecycle: "draft" | "published" | "archived";
  /** The included product's first gallery image (its listing image), for staff to recognise it. */
  image?: ImageAsset;
  quantity: number;
}

export interface ProductContentsView {
  productId: string;
  /** Every included product, whatever its lifecycle, in stored order — staff see drafts the storefront will omit. */
  items: ProductContentItemView[];
}

/** One product's contents with each included product's live fields, read inside the caller's transaction when there is one. */
export async function readProductContents(productId: string): Promise<ProductContentsView> {
  const session = resolveSession();
  const box = await ProductModel.findById(productId, { contents: 1 }, { session }).lean();
  if (!box) throw new NotFoundError("Product not found");

  const entries = box.contents ?? [];
  if (entries.length === 0) return { productId: box._id.toString(), items: [] };

  const included = await ProductModel.find(
    { _id: { $in: entries.map((entry) => entry.productId) } },
    { name: 1, slug: 1, lifecycle: 1, images: { $slice: 1 }, "listing.primaryImage": 1 },
    { session }
  ).lean();
  const byId = new Map(included.map((product) => [product._id.toString(), product]));

  return {
    productId: box._id.toString(),
    // Defensive: an included product that no longer exists is skipped rather than failing the whole read.
    items: entries.flatMap((entry) => {
      const product = byId.get(entry.productId.toString());
      if (!product) return [];
      return [
        {
          productId: product._id.toString(),
          name: product.name,
          slug: product.slug,
          lifecycle: product.lifecycle,
          image: product.images?.[0] ?? product.listing?.primaryImage,
          quantity: entry.quantity,
        },
      ];
    }),
  };
}
