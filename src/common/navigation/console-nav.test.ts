import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { CONSOLE_NAV, firstPermittedRoute } from "./console-nav";

describe("console navigation", () => {
  it("every item carries a typed permission (the UI hides it otherwise; the API enforces it regardless)", () => {
    const items = CONSOLE_NAV.flatMap((section) => section.items);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.permission, item.key).toBeTruthy();
  });

  it("'/' opens the first section the role may use, in navigation order", () => {
    expect(firstPermittedRoute(() => true)).toBe(AppRoute.ORDERS);
    expect(firstPermittedRoute((p) => p === AppPermission.BRAND.READ)).toBe(AppRoute.BRANDS);
  });

  it("every item opens a real page — no link to a screen that was never built", () => {
    const consoleDir = path.resolve(__dirname, "../../app/(console)");
    for (const item of CONSOLE_NAV.flatMap((section) => section.items)) {
      expect(existsSync(path.join(consoleDir, item.href, "page.tsx")), item.href).toBe(true);
    }
  });

  it("a role with no matching permission gets no destination", () => {
    expect(firstPermittedRoute(() => false)).toBeNull();
  });

  it("Today is the landing page, listed for order staff — and '/' is never its own redirect target", () => {
    const today = CONSOLE_NAV.flatMap((section) => section.items).find((item) => item.key === "today");
    expect(today?.href).toBe(AppRoute.HOME);
    // A role whose only permission opens the Today item must not be sent back to "/" (a redirect loop).
    expect(firstPermittedRoute((p) => p === AppPermission.ORDER.READ)).toBe(AppRoute.ORDERS);
  });
});
