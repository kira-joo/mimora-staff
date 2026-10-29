import type mongoose from "mongoose";
import type { PermissionSchema } from "@kira-joo/backend-toolkit-mongoose";
import { RoleModel } from "../../core/authorization/role.model";
import { permissionRepository, roleRepository } from "../../core/repositories";
import { AppPermission, CustomPermission } from "../../../common/authorization/authorization-registry";

/**
 * MDS §2's five staff personas, translated into concrete permission sets.
 *
 * **This mapping is an implementation decision, not a re-statement of the
 * MDS table.** §2 describes each persona in a few words ("Orders,
 * inventory, returns, promotions, reports"); turning that into an exact
 * list of `Entity.action` keys required judgement calls the MDS does not
 * make explicitly — most notably that Manager/Fulfilment/Support are read
 * access plus the specific action permissions their job needs, never a
 * blanket `UPDATE` on an entity they only act on narrowly (granting
 * `Order.update` to Fulfilment so they can transition status would also
 * hand them the ability to edit an order's snapshot, which nothing in §2
 * asks for). Flagged in the Phase 5 report rather than left undocumented.
 *
 * **Owner** uses `grantsAll` rather than an enumerated list — the one
 * mechanism `RoleSchema` provides for "everything, including whatever gets
 * added later" (§2: "Everything"). The other four are exhaustive lists that
 * do NOT automatically pick up a newly added permission; extending their
 * access is the explicit edit this batch's "predefined only" scope defers.
 *
 * **Reports.** `Report` has no CRUD entity; the three MDS §15a reports are
 * one custom permission, `CustomPermission.REPORT_READ`, and Manager's set
 * includes it. Fulfilment, Support and Merchandiser do not hold it — sales
 * figures are not implied by order or catalog access.
 */
const DEFAULT_ROLE_DEFINITIONS: Array<{ name: string; grantsAll?: boolean; permissionKeys?: string[] }> = [
  {
    name: "Owner",
    grantsAll: true,
  },
  {
    name: "Manager",
    permissionKeys: [
      AppPermission.ORDER.READ,
      AppPermission.ORDER.READ_ONE,
      CustomPermission.ORDER_TRANSITION,
      CustomPermission.ORDER_CANCEL,
      CustomPermission.PAYMENT_VERIFY,
      CustomPermission.PAYMENT_REJECT,
      CustomPermission.PAYMENT_REFUND,
      AppPermission.VARIANT.READ,
      CustomPermission.INVENTORY_ADJUST,
      AppPermission.RETURN.READ,
      AppPermission.RETURN.READ_ONE,
      CustomPermission.RETURN_APPROVE,
      CustomPermission.RETURN_RECEIVE,
      AppPermission.PROMOTION.READ,
      AppPermission.PROMOTION.READ_ONE,
      AppPermission.PROMOTION.CREATE,
      AppPermission.PROMOTION.UPDATE,
      AppPermission.PROMOTION.DELETE,
      AppPermission.CUSTOMER.READ,
      AppPermission.CUSTOMER.READ_ONE,
      CustomPermission.REPORT_READ,
      CustomPermission.NOTIFICATION_READ,
    ],
  },
  {
    name: "Merchandiser",
    permissionKeys: [
      AppPermission.PRODUCT.READ,
      AppPermission.PRODUCT.READ_ONE,
      AppPermission.PRODUCT.CREATE,
      AppPermission.PRODUCT.UPDATE,
      AppPermission.PRODUCT.DELETE,
      AppPermission.VARIANT.READ,
      AppPermission.VARIANT.READ_ONE,
      AppPermission.VARIANT.CREATE,
      AppPermission.VARIANT.UPDATE,
      AppPermission.VARIANT.DELETE,
      AppPermission.CATEGORY.READ,
      AppPermission.CATEGORY.READ_ONE,
      AppPermission.CATEGORY.CREATE,
      AppPermission.CATEGORY.UPDATE,
      AppPermission.CATEGORY.DELETE,
      AppPermission.COLLECTION.READ,
      AppPermission.COLLECTION.READ_ONE,
      AppPermission.COLLECTION.CREATE,
      AppPermission.COLLECTION.UPDATE,
      AppPermission.COLLECTION.DELETE,
      AppPermission.BRAND.READ,
      AppPermission.BRAND.READ_ONE,
      AppPermission.BRAND.CREATE,
      AppPermission.BRAND.UPDATE,
      AppPermission.BRAND.DELETE,
      AppPermission.SIZE_GUIDE.READ,
      AppPermission.SIZE_GUIDE.READ_ONE,
      AppPermission.SIZE_GUIDE.CREATE,
      AppPermission.SIZE_GUIDE.UPDATE,
      AppPermission.SIZE_GUIDE.DELETE,
      AppPermission.CATALOG_IMPORT_BATCH.DELETE,
      CustomPermission.CATALOG_PUBLISH,
      AppPermission.PAGE.READ,
      AppPermission.PAGE.READ_ONE,
      AppPermission.PAGE.CREATE,
      AppPermission.PAGE.UPDATE,
      AppPermission.PAGE.DELETE,
      AppPermission.REVIEW.READ,
      AppPermission.REVIEW.UPDATE,
      CustomPermission.NOTIFICATION_READ,
    ],
  },
  {
    name: "Fulfilment",
    permissionKeys: [AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE, CustomPermission.ORDER_TRANSITION, CustomPermission.NOTIFICATION_READ],
  },
  {
    name: "Support",
    permissionKeys: [
      AppPermission.ORDER.READ,
      AppPermission.ORDER.READ_ONE,
      AppPermission.CUSTOMER.READ,
      AppPermission.CUSTOMER.READ_ONE,
      AppPermission.RETURN.READ,
      AppPermission.RETURN.READ_ONE,
      CustomPermission.RETURN_APPROVE,
      CustomPermission.RETURN_RECEIVE,
      CustomPermission.PAYMENT_REFUND,
      CustomPermission.NOTIFICATION_READ,
    ],
  },
];

/**
 * Seeds the five default personas, and tops up their permissions — **additive only**.
 *
 * - **A missing role is created** with its default permissions, as one `bulkWrite()` of `upsert: true` updates so two
 *   cold-starting instances cannot both insert one (`RoleSchema` carries no `@Unique()` on `name`, so a naive
 *   find-then-create would let both observe "no Owner role yet").
 * - **An existing default role gains any default permission it lacks** (`$addToSet`) and loses nothing. This is what
 *   lets a release add a permission (`Notification.read` was the first) to the roles that should have it without a
 *   migration: seeding used to be insert-only, so a database seeded before the key existed never received it.
 *   Permissions a merchant added, the role's `grantsAll` and `isActive`, and its name are never touched.
 * - **Only the default role names are ever written.** A role a merchant created under any other name is invisible here.
 *
 * Known trade-off, deliberate: because the seed cannot tell "never had it" from "had it and it was removed", a default
 * permission a merchant later REMOVES from a default role is added back at the next boot. Roles cannot be edited from the
 * console today (`/api/admin/roles` is read-only), so nothing can remove one yet; the day a role-edit route exists the
 * seed needs a per-role "seeded" marker first, or removals will not stick.
 *
 * Must run after `syncPermissions()` (`instrumentation.ts`), since it resolves each `Entity.action` key to the
 * `Permission` document's `_id`.
 */
export async function seedDefaultRoles(): Promise<{ created: string[]; skipped: string[]; permissionsAdded: Record<string, string[]> }> {
  const allKeys = DEFAULT_ROLE_DEFINITIONS.flatMap((role) => role.permissionKeys ?? []);
  // `PermissionSchema` (toolkit-owned) doesn't declare `_id`; every stored document has one.
  const permissions = (await permissionRepository.findAll({
    where: { key: { $in: allKeys } },
    select: { _id: true, key: true },
  })) as Array<PermissionSchema & { _id: mongoose.Types.ObjectId }>;
  const idByKey = new Map(permissions.map((permission) => [permission.key, permission._id]));
  const resolve = (keys: string[] | undefined) =>
    (keys ?? []).map((key) => {
      const id = idByKey.get(key);
      if (!id) throw new Error(`seedDefaultRoles: permission "${key}" not found — run syncPermissions() first.`);
      return id;
    });

  const existing = (await roleRepository.findAll({
    where: { name: { $in: DEFAULT_ROLE_DEFINITIONS.map((role) => role.name) } },
    select: { name: true, permissions: true },
  })) as unknown as Array<{ name: string; permissions?: Array<{ toString(): string }> }>;
  const heldByName = new Map(existing.map((role) => [role.name, new Set((role.permissions ?? []).map((id) => id.toString()))]));

  // Resolved for every role up front, so a missing `Permission` document is one clear error whichever role it belongs to.
  const idsByRole = new Map(DEFAULT_ROLE_DEFINITIONS.map((role) => [role.name, resolve(role.permissionKeys)]));

  const permissionsAdded: Record<string, string[]> = {};
  for (const role of DEFAULT_ROLE_DEFINITIONS) {
    const held = heldByName.get(role.name);
    const missing = held ? (role.permissionKeys ?? []).filter((key) => !held.has(idByKey.get(key)!.toString())) : [];
    if (missing.length > 0) permissionsAdded[role.name] = missing;
  }

  // A role that exists and lacks nothing is not written at all, so a routine boot leaves `updatedAt` alone too.
  const needsWrite = DEFAULT_ROLE_DEFINITIONS.filter((role) => !heldByName.has(role.name) || permissionsAdded[role.name]);
  if (needsWrite.length > 0) {
    await RoleModel.bulkWrite(
      needsWrite.map((role) => {
        const ids = idsByRole.get(role.name)!;
        return {
          updateOne: {
            filter: { name: role.name },
            // `$setOnInsert` and `$addToSet` may not name the same path, so a role with no permissions (Owner) sets the empty list on insert instead.
            update:
              ids.length > 0
                ? { $setOnInsert: { name: role.name, grantsAll: role.grantsAll ?? false, isActive: true }, $addToSet: { permissions: { $each: ids } } }
                : { $setOnInsert: { name: role.name, grantsAll: role.grantsAll ?? false, isActive: true, permissions: [] } },
            upsert: true,
          },
        };
      })
    );
  }

  return {
    created: DEFAULT_ROLE_DEFINITIONS.map((role) => role.name).filter((name) => !heldByName.has(name)),
    skipped: DEFAULT_ROLE_DEFINITIONS.map((role) => role.name).filter((name) => heldByName.has(name)),
    permissionsAdded,
  };
}
