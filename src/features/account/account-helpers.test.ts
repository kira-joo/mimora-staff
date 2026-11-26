import { describe, expect, it } from "vitest";
import type { OwnAccount } from "src/api/account.endpoints";
import { accountPermissions, passwordProblems } from "./account-helpers";

const permission = (key: string) => ({ key, name: key, entity: key.split(".")[0]!, action: key.split(".")[1]!, isSystem: true });

describe("account helpers", () => {
  it("collects distinct permissions from active roles only", () => {
    const account = {
      roles: [
        { _id: "a", name: "A", grantsAll: false, isActive: true, permissions: [permission("Order.read"), permission("Product.read")] },
        { _id: "b", name: "B", grantsAll: false, isActive: true, permissions: [permission("Order.read")] },
        { _id: "c", name: "C", grantsAll: false, isActive: false, permissions: [permission("Payment.refund")] },
      ],
    } as unknown as OwnAccount;
    expect(accountPermissions(account).map((p) => p.key).sort()).toEqual(["Order.read", "Product.read"]);
  });

  it("checks length, difference from the current password, and confirmation", () => {
    expect(passwordProblems({ currentPassword: "old-password-1", newPassword: "short", confirmPassword: "short" }, 10)).toEqual({ newPassword: "Use at least 10 characters." });
    expect(passwordProblems({ currentPassword: "same-password", newPassword: "same-password", confirmPassword: "same-password" }, 10).newPassword).toMatch(/different/);
    expect(passwordProblems({ currentPassword: "old-password-1", newPassword: "new-password-1", confirmPassword: "new-password-2" }, 10)).toEqual({ confirmPassword: "The passwords don't match." });
    expect(passwordProblems({ currentPassword: "old-password-1", newPassword: "new-password-1", confirmPassword: "new-password-1" }, 10)).toEqual({});
  });
});
