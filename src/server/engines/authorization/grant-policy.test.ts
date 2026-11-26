import { describe, expect, it } from "vitest";
import { actorAccess, combineAccess, covers, grantRefusal, ungrantableKeys } from "./grant-policy";

const owner = actorAccess([{ grantsAll: true, permissions: [] }]);
const manager = actorAccess([
  { grantsAll: false, permissions: ["Order.read", "Role.update"] },
  { grantsAll: false, permissions: ["Product.read"] },
]);
const nobody = actorAccess([]);

describe("grant policy", () => {
  it("unions the actor's roles", () => {
    expect(manager.grantsAll).toBe(false);
    expect([...manager.keys].sort()).toEqual(["Order.read", "Product.read", "Role.update"]);
    expect(owner.grantsAll).toBe(true);
  });

  it("an actor with full access may grant anything, including full access", () => {
    expect(grantRefusal(owner, { grantsAll: true, permissionKeys: [] })).toBeNull();
    expect(grantRefusal(owner, { grantsAll: false, permissionKeys: ["Payment.refund"] })).toBeNull();
    expect(covers(owner, { grantsAll: true, permissionKeys: ["anything"] })).toBe(true);
  });

  it("refuses full access to anyone who lacks it — the escalation that matters most", () => {
    expect(grantRefusal(manager, { grantsAll: true, permissionKeys: [] })).toEqual({ reason: "grantsAll" });
    expect(covers(manager, { grantsAll: true, permissionKeys: [] })).toBe(false);
  });

  it("allows granting a subset of one's own permissions, and the empty set", () => {
    expect(grantRefusal(manager, { grantsAll: false, permissionKeys: ["Order.read"] })).toBeNull();
    expect(grantRefusal(manager, { grantsAll: false, permissionKeys: ["Order.read", "Product.read"] })).toBeNull();
    expect(grantRefusal(manager, { grantsAll: false, permissionKeys: [] })).toBeNull();
    expect(grantRefusal(nobody, { grantsAll: false, permissionKeys: [] })).toBeNull();
  });

  it("names every permission the actor does not hold, once, sorted", () => {
    expect(grantRefusal(manager, { grantsAll: false, permissionKeys: ["Payment.refund", "Order.read", "Customer.redact", "Payment.refund"] })).toEqual({
      reason: "permissions",
      keys: ["Customer.redact", "Payment.refund"],
    });
    expect(ungrantableKeys(nobody, { grantsAll: false, permissionKeys: ["Order.read"] })).toEqual(["Order.read"]);
  });

  it("combines the roles being assigned before judging them", () => {
    const assigned = combineAccess([
      { grantsAll: false, permissionKeys: ["Order.read"] },
      { grantsAll: false, permissionKeys: ["Order.read", "Customer.read"] },
    ]);
    expect(assigned).toEqual({ grantsAll: false, permissionKeys: ["Order.read", "Customer.read"] });
    expect(covers(manager, assigned)).toBe(false);
    expect(combineAccess([{ grantsAll: false, permissionKeys: [] }, { grantsAll: true, permissionKeys: [] }]).grantsAll).toBe(true);
    expect(combineAccess([])).toEqual({ grantsAll: false, permissionKeys: [] });
  });
});
