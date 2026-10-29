import { describe, expect, it } from "vitest";
import { bellLabel, unreadBadge } from "./notification-display";

describe("notification bell display", () => {
  it("shows no badge at zero, the count below 100, and 99+ above", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(-1)).toBeNull();
    expect(unreadBadge(7)).toBe("7");
    expect(unreadBadge(99)).toBe("99");
    expect(unreadBadge(100)).toBe("99+");
  });
  it("names the count in the accessible label, never in the badge alone", () => {
    expect(bellLabel(0)).toBe("Notifications, none unread");
    expect(bellLabel(3)).toBe("Notifications, 3 unread");
    expect(bellLabel(250)).toBe("Notifications, more than 99 unread");
  });
});
