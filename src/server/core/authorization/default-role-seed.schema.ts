import { MongoField, MongoSchema, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * What the boot seed has already done for one default role — the memory that makes roles editable.
 *
 * Before roles could be edited, the seed matched default roles by NAME and re-added every default permission at each
 * boot. Once an Owner can rename, delete or trim a role, that behaviour would undo their edits on the next deploy:
 * a renamed "Manager" would be recreated, a deleted one resurrected, a removed permission put back. This record ties
 * each default definition to the role document it produced (`roleId`, not name) and lists every permission key the
 * seed has ever granted it, so a later boot only adds keys a NEW release introduced — never one the merchant removed.
 *
 * `RoleSchema` is owned by `@kira-joo/backend-toolkit-mongoose` and has no room for this, hence its own collection.
 */
@MongoSchema({ timestamps: true })
export class DefaultRoleSeedSchema {
  _id!: mongoose.Types.ObjectId;

  /** The default definition's name at the time it was seeded ("Owner", "Manager", …) — the record's identity. */
  @Unique()
  @MongoField({ type: String, required: true })
  definition!: string;

  /** The role document the definition produced. It may since have been renamed or deleted; neither is undone. */
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true })
  roleId!: mongoose.Types.ObjectId;

  /** Every permission key the seed has granted this role, ever. A key listed here is never re-added. */
  @MongoField({ type: [String], default: () => [] })
  seededPermissionKeys!: string[];
}

export const DefaultRoleSeedModel = createMongoModel("DefaultRoleSeed", DefaultRoleSeedSchema);
