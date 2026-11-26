import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_DEFINITIONS, AppPermission, CustomPermission } from "./authorization-registry";
import { ASSIGNABLE_PERMISSION_KEYS, PERMISSION_SECTIONS, UNENFORCED_PERMISSION_KEYS } from "./permission-catalog";

const ADMIN_ROOT = join(__dirname, "../../app/api/admin");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

/** Every permission key some admin route references, resolved from `AppPermission.X.Y` / `CustomPermission.Z`. */
function enforcedKeys(): Set<string> {
  const keys = new Set<string>();
  const app = AppPermission as unknown as Record<string, Record<string, string>>;
  const custom = CustomPermission as unknown as Record<string, string>;
  for (const file of routeFiles(ADMIN_ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/AppPermission\.([A-Z_]+)\.([A-Z_]+)/g)) {
      const key = app[match[1]!]?.[match[2]!];
      expect(key, `${file}: AppPermission.${match[1]}.${match[2]} does not exist`).toBeDefined();
      keys.add(key!);
    }
    for (const match of source.matchAll(/CustomPermission\.([A-Z_]+)/g)) {
      const key = custom[match[1]!];
      expect(key, `${file}: CustomPermission.${match[1]} does not exist`).toBeDefined();
      keys.add(key!);
    }
  }
  return keys;
}

describe("the permission catalog matches what the routes enforce", () => {
  const enforced = enforcedKeys();

  it("found the admin routes", () => {
    expect(enforced.size).toBeGreaterThan(50);
  });

  it("offers every enforced key — a permission a route checks must be grantable", () => {
    expect([...enforced].filter((key) => !ASSIGNABLE_PERMISSION_KEYS.has(key))).toEqual([]);
  });

  it("offers nothing that guards nothing — the unenforced list is exactly the defined keys no route checks", () => {
    const defined = ALL_PERMISSION_DEFINITIONS.map((definition) => definition.key);
    expect([...UNENFORCED_PERMISSION_KEYS].sort()).toEqual(defined.filter((key) => !enforced.has(key)).sort());
  });

  it("places every assignable entity in a matrix section", () => {
    const placed = new Set(PERMISSION_SECTIONS.flatMap((section) => section.modules.map((module) => module.entity)));
    const entities = new Set([...ASSIGNABLE_PERMISSION_KEYS].map((key) => key.split(".")[0]!));
    expect([...entities].filter((entity) => !placed.has(entity))).toEqual([]);
  });

  it("covers the modules the owner asked for with view/create/edit/delete", () => {
    for (const entity of ["Product", "Category", "Collection", "StaffUser", "Role"]) {
      for (const action of ["read", "create", "update", "delete"]) {
        if (entity === "StaffUser" && action === "delete") continue; // staff are deactivated, never deleted
        expect(ASSIGNABLE_PERMISSION_KEYS.has(`${entity}.${action}`), `${entity}.${action}`).toBe(true);
      }
    }
    expect(ASSIGNABLE_PERMISSION_KEYS.has("Order.read")).toBe(true);
  });
});
