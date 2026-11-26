import { describe, expect, it } from "vitest";
import { buildCreateDirectBody, mapCreateDirectDefaults } from "./create-staff-helpers";

describe("direct account creation helpers", () => {
  it("defaults to requiring a new password at first sign-in", () => {
    expect(mapCreateDirectDefaults().mustChangePassword).toBe(true);
  });

  it("never sends the confirmation, trims name/email, and keeps the password exactly as typed", () => {
    const body = buildCreateDirectBody({ name: " Nadia ", email: " n@example.com ", password: "  spaced pass  ", confirmPassword: "  spaced pass  ", mustChangePassword: false, roleIds: ["r1"] });
    expect(body).toEqual({ name: "Nadia", email: "n@example.com", password: "  spaced pass  ", roleIds: ["r1"], mustChangePassword: false });
    expect(body).not.toHaveProperty("confirmPassword");
  });
});
