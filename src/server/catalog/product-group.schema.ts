import { MongoField, MongoSchema, localizedStringField, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * A set of separate products that are versions of one item — the same slipper in brown, pink and cream. Each member
 * stays a complete product of its own (record, slug, images, variants, price, stock); the group only lets the
 * storefront offer the others as alternatives on a product page.
 *
 * **Membership is stored on the product (`ProductSchema.group`), not here.** A product belongs to at most one group
 * because it has one `group` field; moving it rewrites that one field; archiving or deleting it leaves no dangling id
 * behind; and the storefront finds the siblings with one indexed query. This document holds only what belongs to the
 * group itself.
 *
 * Distinct from option axes and variants (choices WITHIN one product, sharing its page) and from collections
 * (merchandising sets with their own storefront page). Never inferred from names — staff assign every member.
 */
@MongoSchema({ timestamps: true })
export class ProductGroupSchema {
  _id!: mongoose.Types.ObjectId;

  /** Staff-facing; the storefront labels each member by its own `group.label`. */
  @MongoField(localizedStringField())
  name!: LocalizedString;

  /**
   * Bumped by every write to the group or its membership, and the token a membership save must present: a save
   * built from an older read is refused instead of silently replacing another person's changes. Writing it also
   * makes every membership change and the group's deletion write this document, so two of them in flight conflict
   * at the database rather than attaching a product to a group that was just deleted.
   */
  @MongoField({ type: Number, default: 0 })
  revision!: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ProductGroupModel = createMongoModel("ProductGroup", ProductGroupSchema);
