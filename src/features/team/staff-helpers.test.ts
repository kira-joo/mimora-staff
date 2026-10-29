import { describe, expect, it } from "vitest";
import type { StaffMember } from "src/api/staff.endpoints";
import { buildInviteBody, buildUpdateBody, mapStaffToFormValues, sessionImpact } from "./staff-helpers";

const member: StaffMember = {
  _id: "s1",
  name: "Mona",
  email: "mona@qa.local",
  active: true,
  roles: [
    { _id: "r1", name: "Manager", grantsAll: false, isActive: true },
    { _id: "r2", name: "Support", grantsAll: false, isActive: true },
  ],
};

describe("mapStaffToFormValues", () => {
  it("defaults an invite to active with no roles", () => {
    expect(mapStaffToFormValues()).toEqual({ name: "", email: "", roleIds: [], active: true });
  });
  it("maps roles to ids", () => {
    expect(mapStaffToFormValues(member).roleIds).toEqual(["r1", "r2"]);
  });
});

describe("buildInviteBody", () => {
  it("trims name and email", () => {
    expect(buildInviteBody({ name: " Mona ", email: " m@x.com ", roleIds: ["r1"], active: true })).toEqual({ name: "Mona", email: "m@x.com", roleIds: ["r1"] });
  });
});

describe("buildUpdateBody", () => {
  const base = mapStaffToFormValues(member);
  it("sends nothing when nothing changed (so no one is signed out)", () => {
    expect(buildUpdateBody(member, base)).toEqual({});
  });
  it("sends only the name for a rename", () => {
    expect(buildUpdateBody(member, { ...base, name: "Mona S" })).toEqual({ name: "Mona S" });
  });
  it("treats role order as irrelevant", () => {
    expect(buildUpdateBody(member, { ...base, roleIds: ["r2", "r1"] })).toEqual({});
  });
  it("sends roleIds when the set differs, including emptied", () => {
    expect(buildUpdateBody(member, { ...base, roleIds: ["r1"] })).toEqual({ roleIds: ["r1"] });
    expect(buildUpdateBody(member, { ...base, roleIds: [] })).toEqual({ roleIds: [] });
  });
  it("sends active only when it flipped", () => {
    expect(buildUpdateBody(member, { ...base, active: false })).toEqual({ active: false });
  });
});

describe("sessionImpact", () => {
  it("is null for a rename", () => {
    expect(sessionImpact({ name: "x" })).toBeNull();
  });
  it("warns about sign-out on deactivation", () => {
    const impact = sessionImpact({ active: false })!;
    expect(impact.destructive).toBe(true);
    expect(impact.description("Mona")).toMatch(/signed out/);
  });
  it("warns about sign-out on a role change", () => {
    const impact = sessionImpact({ roleIds: ["r1"] })!;
    expect(impact.title("Mona")).toMatch(/roles/);
    expect(impact.description("Mona")).toMatch(/signed out/);
  });
  it("treats reactivation as non-destructive", () => {
    expect(sessionImpact({ active: true })!.destructive).toBe(false);
  });
});
