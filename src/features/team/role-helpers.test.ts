import { describe, expect, it } from "vitest";
import type { Role } from "src/api/roles.endpoints";
import { buildCreateRoleBody, buildUpdateRoleBody, mapRoleToFormValues, memberLabel } from "./role-helpers";

const role: Role = {
  _id: "r1",
  name: "Manager",
  grantsAll: false,
  isActive: true,
  memberCount: 2,
  activeMemberCount: 2,
  isOwnerRole: false,
  permissions: [
    { _id: "p1", key: "Order.read", entity: "Order", action: "read", name: "Read Orders", isActive: true, isSystem: true },
    { _id: "p2", key: "Gone.read", entity: "Gone", action: "read", name: "Gone", isActive: false, isSystem: true },
  ],
};

describe("role helpers", () => {
  it("maps a role to form values — keeping every held key, even a switched-off one, so saving never drops it — and has create defaults", () => {
    expect(mapRoleToFormValues(role)).toEqual({ name: "Manager", isActive: true, grantsAll: false, permissionKeys: ["Gone.read", "Order.read"] });
    expect(mapRoleToFormValues()).toEqual({ name: "", isActive: true, grantsAll: false, permissionKeys: [] });
  });

  it("sends only what changed on edit, and nothing for an untouched form", () => {
    expect(buildUpdateRoleBody(role, mapRoleToFormValues(role))).toEqual({});
    expect(buildUpdateRoleBody(role, { ...mapRoleToFormValues(role), name: " Store manager ", permissionKeys: ["Product.read", "Gone.read", "Order.read"] })).toEqual({
      name: "Store manager",
      permissionKeys: ["Gone.read", "Order.read", "Product.read"],
    });
    expect(buildUpdateRoleBody(role, { ...mapRoleToFormValues(role), permissionKeys: ["Order.read", "Gone.read"] })).toEqual({});
  });

  it("builds a create body with a trimmed name", () => {
    expect(buildCreateRoleBody({ name: "  Packers ", isActive: true, grantsAll: false, permissionKeys: ["b", "a"] })).toEqual({ name: "Packers", isActive: true, grantsAll: false, permissionKeys: ["a", "b"] });
  });

  it("labels member counts", () => {
    expect([memberLabel(0), memberLabel(1), memberLabel(4)]).toEqual(["No one", "1 team member", "4 team members"]);
  });
});
