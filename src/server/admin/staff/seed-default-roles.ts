import type mongoose from "mongoose";
import type { PermissionSchema } from "@kira-joo/backend-toolkit-mongoose";
import { RoleModel } from "../../core/authorization/role.model";
import { DefaultRoleSeedModel } from "../../core/authorization/default-role-seed.schema";
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
export interface DefaultRoleDefinition {
  name: string;
  grantsAll?: boolean;
  permissionKeys?: string[];
}

export const DEFAULT_ROLE_DEFINITIONS: DefaultRoleDefinition[] = [
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
      AppPermission.PRODUCT_GROUP.READ,
      AppPermission.PRODUCT_GROUP.READ_ONE,
      AppPermission.PRODUCT_GROUP.CREATE,
      AppPermission.PRODUCT_GROUP.UPDATE,
      AppPermission.PRODUCT_GROUP.DELETE,
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


export interface SeedDefaultRolesResult {
  created: string[];
  skipped: string[];
  /** Default permission keys added to an existing role this run, by definition name. */
  permissionsAdded: Record<string, string[]>;
}

type StoredRole = { _id: mongoose.Types.ObjectId; name: string; permissions?: Array<{ toString(): string }> };
type SeedRecord = { definition: string; roleId: mongoose.Types.ObjectId; seededPermissionKeys: string[] };

/**
 * Seeds the default roles once, and afterwards adds ONLY permission keys a release introduces — never one the merchant
 * removed. Roles are editable (`/api/admin/roles`), so the seed must not undo an Owner's edits at the next deploy.
 *
 * Each definition has a `DefaultRoleSeed` record naming the role document it produced (by id) and every key the seed
 * has ever granted it:
 *
 * - **No record, no role of that name** (a new database): the role is created with its defaults and a record written.
 * - **No record, a role of that name exists** (a database seeded before records existed — production on the first boot
 *   of this release): the role is ADOPTED unchanged — nothing added or removed — and a record lists all its current
 *   defaults as seeded, so from now on removals stick and only a later release's new keys are offered.
 * - **A record**: only keys missing from `seededPermissionKeys` are added — a key a later release adds to a definition.
 *   A role the merchant renamed is still found by id; a role the merchant DELETED is not recreated.
 *
 * Permissions a merchant added, `grantsAll`, `isActive` and the name are never written to an existing role. Idempotent:
 * a routine boot reads twice and writes nothing. Must run after `reconcilePermissions()` (keys resolve to `_id`s).
 */
export async function seedDefaultRoles(definitions: readonly DefaultRoleDefinition[] = DEFAULT_ROLE_DEFINITIONS): Promise<SeedDefaultRolesResult> {
  const allKeys = [...new Set(definitions.flatMap((role) => role.permissionKeys ?? []))];
  // `PermissionSchema` (toolkit-owned) doesn't declare `_id`; every stored document has one.
  const permissions = (await permissionRepository.findAll({
    where: { key: { $in: allKeys } },
    select: { _id: true, key: true },
  })) as Array<PermissionSchema & { _id: mongoose.Types.ObjectId }>;
  const idByKey = new Map(permissions.map((permission) => [permission.key, permission._id]));
  for (const key of allKeys) {
    if (!idByKey.has(key)) throw new Error(`seedDefaultRoles: permission "${key}" not found — run reconcilePermissions() first.`);
  }
  const ids = (keys: readonly string[]) => keys.map((key) => idByKey.get(key)!);

  const records = (await DefaultRoleSeedModel.find({ definition: { $in: definitions.map((role) => role.name) } }).lean()) as unknown as SeedRecord[];
  const recordByName = new Map(records.map((record) => [record.definition, record]));
  const roles = (await roleRepository.findAll({
    where: { $or: [{ _id: { $in: records.map((record) => record.roleId) } }, { name: { $in: definitions.map((role) => role.name) } }] },
    select: { name: true, permissions: true },
  })) as unknown as StoredRole[];
  const roleById = new Map(roles.map((role) => [role._id.toString(), role]));
  const roleByName = new Map(roles.map((role) => [role.name, role]));

  const result: SeedDefaultRolesResult = { created: [], skipped: [], permissionsAdded: {} };

  for (const definition of definitions) {
    const defaults = definition.permissionKeys ?? [];
    const record = recordByName.get(definition.name);

    // The full-access Owner role is never left missing (the API refuses to delete it; `bootstrap-owner` needs it), so a
    // record pointing at a vanished Owner role is treated as no record and the role is ensured again below.
    const recordedRole = record ? roleById.get(record.roleId.toString()) : undefined;
    if (record && (recordedRole || !definition.grantsAll)) {
      const role = recordedRole;
      // Deleted by the merchant: their decision stands.
      if (!role) {
        result.skipped.push(definition.name);
        continue;
      }
      const seeded = new Set(record.seededPermissionKeys);
      const fresh = defaults.filter((key) => !seeded.has(key));
      result.skipped.push(definition.name);
      if (fresh.length === 0) continue;
      const held = new Set((role.permissions ?? []).map((id) => id.toString()));
      const toAdd = fresh.filter((key) => !held.has(idByKey.get(key)!.toString()));
      if (toAdd.length > 0) {
        await RoleModel.updateOne({ _id: role._id }, { $addToSet: { permissions: { $each: ids(toAdd) } } });
        result.permissionsAdded[definition.name] = toAdd;
      }
      await DefaultRoleSeedModel.updateOne({ definition: definition.name }, { $addToSet: { seededPermissionKeys: { $each: fresh } } });
      continue;
    }

    let roleId: mongoose.Types.ObjectId;
    const existing = roleByName.get(definition.name);
    if (existing) {
      // Adopted exactly as it stands: its permissions are the merchant's, so none is added or removed. From now on
      // only a key a later release introduces is offered to it.
      roleId = existing._id;
      result.skipped.push(definition.name);
    } else {
      // An upsert keyed on the name, so concurrent cold starts converge on one document.
      const upserted = await RoleModel.findOneAndUpdate(
        { name: definition.name },
        { $setOnInsert: { name: definition.name, grantsAll: definition.grantsAll ?? false, isActive: true, permissions: ids(defaults) } },
        { upsert: true, new: true, projection: { _id: 1 } }
      ).lean();
      roleId = upserted!._id as mongoose.Types.ObjectId;
      result.created.push(definition.name);
    }

    await DefaultRoleSeedModel.updateOne(
      { definition: definition.name },
      { $set: { roleId }, $addToSet: { seededPermissionKeys: { $each: defaults } } },
      { upsert: true }
    );
  }

  return result;
}

/** The single coarse staff permission that granular `StaffUser.*` permissions replaced. No route checks it any more. */
export const LEGACY_STAFF_MANAGE_KEY = "StaffUser.manage";

/**
 * One-way migration: an active role that held the retired `StaffUser.manage` (itself active) receives the granular
 * permissions that now guard the same routes (`StaffUser.read`/`readOne`/`create`/`update`), so nobody loses access
 * they had, and the legacy reference is then removed so the migration never repeats. Production held it on no role
 * (2026-11-26), so there it is one read and nothing else.
 */
export async function migrateLegacyStaffManage(): Promise<{ rolesUpdated: number }> {
  const legacy = (await permissionRepository.findOne({ where: { key: LEGACY_STAFF_MANAGE_KEY }, select: { _id: true, isActive: true }, skipThrowError: true })) as
    | (PermissionSchema & { _id: mongoose.Types.ObjectId })
    | null;
  if (!legacy) return { rolesUpdated: 0 };

  // A legacy grant that was switched off conferred nothing; turning it into live access now would be an escalation.
  if (legacy.isActive) {
    const replacementKeys = [AppPermission.STAFF_USER.READ, AppPermission.STAFF_USER.READ_ONE, AppPermission.STAFF_USER.CREATE, AppPermission.STAFF_USER.UPDATE];
    const replacements = (await permissionRepository.findAll({ where: { key: { $in: replacementKeys } }, select: { _id: true } })) as unknown as Array<{ _id: mongoose.Types.ObjectId }>;
    if (replacements.length !== replacementKeys.length) throw new Error("migrateLegacyStaffManage: StaffUser permissions missing — run reconcilePermissions() first.");
    // Only ACTIVE roles: an inactive role's legacy grant conferred nothing either.
    await RoleModel.updateMany({ permissions: legacy._id, isActive: true }, { $addToSet: { permissions: { $each: replacements.map((permission) => permission._id) } } });
  }

  // Then the legacy reference is retired, so this runs once per role: a replacement an Owner later removes is not put
  // back at the next boot. Two writes, not one (MongoDB refuses $addToSet and $pull on one path); a crash between them
  // only repeats the idempotent first write on the next boot.
  const retired = await RoleModel.updateMany({ permissions: legacy._id }, { $pull: { permissions: legacy._id } });
  return { rolesUpdated: retired.modifiedCount };
}
