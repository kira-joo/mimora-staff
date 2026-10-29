import { describe, expect, it } from "vitest";
import type { RolePermission } from "src/api/roles.endpoints";
import { groupPermissions, humanizeEntity } from "./role-permissions";

const p = (entity: string, action: string, isSystem: boolean, name = `${action} ${entity}`): RolePermission => ({
  _id: `${entity}.${action}`,
  key: `${entity}.${action}`,
  entity,
  action,
  name,
  isActive: true,
  isSystem,
});

describe("groupPermissions", () => {
  it("groups by entity, sorted, with CRUD verbs and custom names", () => {
    const groups = groupPermissions([p("Order", "readOne", true), p("Order", "transition", false, "Transition Order Status"), p("Customer", "read", true)]);
    expect(groups.map((g) => g.entity)).toEqual(["Customer", "Order"]);
    expect(groups[1]?.items.map((i) => i.label)).toEqual(["View one", "Transition Order Status"]);
  });
  it("returns nothing for no permissions", () => {
    expect(groupPermissions([])).toEqual([]);
  });
});

describe("humanizeEntity", () => {
  it("splits camel case", () => {
    expect(humanizeEntity("StaffUser")).toBe("Staff user");
    expect(humanizeEntity("Order")).toBe("Order");
  });
});
