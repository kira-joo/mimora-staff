import {
  MongoField,
  MongoSchema,
  Relation,
  RoleSchema,
  Unique,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * Staff user account.
 *
 * Separate from Customer — no shared users collection, no audience discriminator.
 *
 * **Phase 4 correction, not a Phase 2 amendment.** The version committed in
 * `09c8588` carried a single flat `role: string`, which cannot express "has
 * exactly this permission but not others" — the granularity every
 * `/api/admin/**` route's `auth: {permissions}` and this phase's own
 * permission-coverage test require. `restaurant-platform-staff` (the
 * reference architecture) resolves this via a real relation to
 * `@kira-joo/backend-toolkit-mongoose`'s `RoleSchema`/`PermissionSchema` —
 * `roles[]` here matches that shape and the canonical MDS's own
 * `StaffUser.roles[]` description. Nothing in this repository read the old
 * `role` field (no routes existed before this phase), so there is no
 * migration to reconcile.
 */
@MongoSchema({ timestamps: true })
export class StaffUserSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true, lowercase: true, trim: true })
  email!: string;

  /**
   * Absent, not empty-string, for an invited account that has not yet set a
   * password (`invite-staff.ts`) — matching `restaurant-platform-staff`'s
   * (the reference architecture's) own schema, whose doc comment states
   * "an account with no hash" is treated identically to an unknown account
   * by login, never as a distinguishable third state.
   */
  @MongoField({ type: String, required: false, select: false })
  passwordHash?: string;

  @MongoField({ type: String, required: true, trim: true })
  name!: string;

  @Relation(() => RoleSchema)
  @MongoField({ type: [mongoose.Schema.Types.ObjectId], ref: "Role", default: () => [] })
  roles!: mongoose.Types.ObjectId[];

  @MongoField({ type: Boolean, default: true })
  active!: boolean;

  /**
   * SHA-256 of the outstanding invitation token, and its expiry. Set by
   * invite/re-invite, cleared by activation in the same atomic write that sets
   * `passwordHash` — so a used, expired or superseded token matches nothing.
   * `select: false` like `passwordHash`: even a hash never leaves in a response.
   */
  @MongoField({ type: String, required: false, select: false })
  passwordResetTokenHash?: string;

  @MongoField({ type: Date, required: false, select: false })
  passwordResetExpiresAt?: Date;

  @MongoField({ type: Date, required: false })
  lastLoginAt?: Date;

  @MongoField({ type: Number, default: 1 })
  tokenVersion!: number;
}

export const StaffUserModel = createMongoModel("StaffUser", StaffUserSchema);
