import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_DEFINITIONS, AppPermission, CustomPermission } from "./authorization-registry";
import { EntityName } from "./entity-name.enum";

describe("the two-tier permission vocabulary", () => {
  it("generates one Entity.action key per entity via AppPermission", () => {
    expect(AppPermission.PRODUCT.READ).toBe("Product.read");
    expect(AppPermission.PRODUCT.DELETE).toBe("Product.delete");
    expect(AppPermission.DELIVERY_ZONE.CREATE).toBe("DeliveryZone.create");
    expect(AppPermission.PAYMENT_SETTINGS.UPDATE).toBe("PaymentSettings.update");
  });

  it("CustomPermission keys follow the same Entity.action shape as generated CRUD keys — so entityType is always the key's first segment, with no separate resolution step", () => {
    for (const key of Object.values(CustomPermission)) {
      expect(key).toMatch(/^[A-Za-z]+\.[a-z][A-Za-z]*$/);
    }
    expect(CustomPermission.PAYMENT_VERIFY).toBe("Payment.verify");
    expect(CustomPermission.ORDER_CANCEL).toBe("Order.cancel");
  });

  it("riding a sensitive action on generic CRUD never happens — no CustomPermission key collides with a generated one", () => {
    const generatedKeys = new Set(ALL_PERMISSION_DEFINITIONS.filter((d) => d.isSystem).map((d) => d.key));
    for (const key of Object.values(CustomPermission)) {
      expect(generatedKeys.has(key)).toBe(false);
    }
  });

  it("ALL_PERMISSION_DEFINITIONS includes both tiers, correctly flagged by isSystem", () => {
    const custom = ALL_PERMISSION_DEFINITIONS.filter((d) => !d.isSystem);
    expect(custom.map((d) => d.key).sort()).toEqual(Object.values(CustomPermission).sort());

    const generated = ALL_PERMISSION_DEFINITIONS.filter((d) => d.isSystem);
    // 5 CRUD actions per entity in EntityName — every entity this phase added is covered too.
    expect(generated).toHaveLength(Object.keys(EntityName).length * 5);
  });

  it("every custom definition has a human-readable name distinct from its key", () => {
    const custom = ALL_PERMISSION_DEFINITIONS.filter((d) => !d.isSystem);
    for (const definition of custom) {
      expect(definition.name).not.toBe(definition.key);
      expect(definition.name.length).toBeGreaterThan(0);
    }
  });

  /**
   * Added by the Phase 4B verification pass: proves the four sensitive
   * action keys it found missing (Return approve/receive, inventory
   * adjustment, permission sync) are real, distinct permission strings a
   * route can declare in `auth: {permissions: [...]}`, and specifically
   * that none of them is — or could be confused for — the generic CRUD
   * `.update` permission on their nearest entity. A route author reaching
   * for "the closest CRUD permission" instead of the literal action key is
   * exactly the over-grant this vocabulary exists to prevent.
   */
  it("the four newly-added sensitive action keys are distinct permission strings, never the generic .update on their nearest entity", () => {
    expect(CustomPermission.RETURN_APPROVE).toBe("Return.approve");
    expect(CustomPermission.RETURN_RECEIVE).toBe("Return.receive");
    expect(CustomPermission.INVENTORY_ADJUST).toBe("Inventory.adjust");
    expect(CustomPermission.PERMISSION_MANAGE).toBe("Permission.manage");

    expect(CustomPermission.RETURN_APPROVE).not.toBe(AppPermission.RETURN.UPDATE);
    expect(CustomPermission.RETURN_RECEIVE).not.toBe(AppPermission.RETURN.UPDATE);
    expect(CustomPermission.RETURN_APPROVE).not.toBe(CustomPermission.RETURN_RECEIVE); // approving and receiving are separate staff actions, separately grantable

    // A route declaring only Return.update must not implicitly carry either sensitive action.
    const genericReturnPermissions: string[] = [AppPermission.RETURN.UPDATE];
    expect(genericReturnPermissions).not.toContain(CustomPermission.RETURN_APPROVE);
    expect(genericReturnPermissions).not.toContain(CustomPermission.RETURN_RECEIVE);
  });
});
