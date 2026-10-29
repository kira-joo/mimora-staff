import { describe, expect, it } from "vitest";
import { AppRoute, SIGNED_OUT_ROUTES, safeRedirectPath } from "./app-route";

describe("safeRedirectPath — sign-in can never become an open redirect", () => {
  it.each([
    ["/orders?status=PLACED", "/orders?status=PLACED"],
    ["/catalog/brands/abc", "/catalog/brands/abc"],
  ])("keeps a same-origin path: %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([null, undefined, "", "https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "orders", AppRoute.LOGIN, `${AppRoute.LOGIN}?redirectTo=%2F`])(
    "falls back to home for %s",
    (input) => {
      expect(safeRedirectPath(input as string | null | undefined)).toBe(AppRoute.HOME);
    }
  );
});

describe("SIGNED_OUT_ROUTES", () => {
  it("covers every screen that answers a 401 itself, so onUnauthorized never redirects away from it", () => {
    expect(SIGNED_OUT_ROUTES).toEqual(expect.arrayContaining([AppRoute.LOGIN, AppRoute.ACCEPT_INVITE]));
  });
});
