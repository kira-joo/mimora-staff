import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { ImageAsset, LocalizedString } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { resolveSession } from "@kira-joo/backend-toolkit-mongoose";
import { ProductModel } from "../../catalog/product.schema";
import { ProductGroupModel } from "../../catalog/product-group.schema";

export interface ProductGroupMemberView {
  productId: string;
  name: LocalizedString;
  slug: string;
  lifecycle: "draft" | "published" | "archived";
  /** The product's first gallery image (its listing image), for staff to recognise it. */
  image?: ImageAsset;
  label: LocalizedString;
  order: number;
}

export interface ProductGroupDetail {
  _id: string;
  name: LocalizedString;
  /** Send back as `expectedRevision` when saving the membership. */
  revision: number;
  createdAt?: Date;
  updatedAt?: Date;
  /** Every member, whatever its lifecycle, in group order — staff must see archived members to restore or move them. */
  members: ProductGroupMemberView[];
}

/** One group with its members, read inside the caller's transaction when there is one. */
export async function readProductGroupDetail(groupId: string): Promise<ProductGroupDetail> {
  const session = resolveSession();
  const group = await ProductGroupModel.findById(groupId, null, { session }).lean();
  if (!group) throw new NotFoundError("Product group not found");
  const members = await ProductModel.find({ "group.groupId": group._id }, { name: 1, slug: 1, lifecycle: 1, images: { $slice: 1 }, "listing.primaryImage": 1, group: 1 }, { session })
    .sort({ "group.order": 1, _id: 1 })
    .lean();
  return {
    _id: group._id.toString(),
    name: group.name,
    revision: group.revision ?? 0,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    members: members.map((product) => ({
      productId: product._id.toString(),
      name: product.name,
      slug: product.slug,
      lifecycle: product.lifecycle,
      image: product.images?.[0] ?? product.listing?.primaryImage,
      label: product.group!.label,
      order: product.group!.order,
    })),
  };
}

/** Member count per group id, for the list. */
export async function countMembers(groupIds: mongoose.Types.ObjectId[]): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();
  const rows = await ProductModel.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { "group.groupId": { $in: groupIds } } },
    { $group: { _id: "$group.groupId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row.count]));
}
