// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const cookieValue = vi.fn<() => string | undefined>();
const verifyAuthToken = vi.fn();
const connectToDatabase = vi.fn();
const resolveStaffUser = vi.fn();

vi.mock("../ensure-configured", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookieValue() ? { value: cookieValue() } : undefined) }) }));
vi.mock("@kira-joo/backend-toolkit-next", () => ({ verifyAuthToken }));
vi.mock("../db/connect", () => ({ connectToDatabase }));
vi.mock("./resolve-staff-user", () => ({ resolveStaffUser }));

const { getCurrentStaffUser } = await import("./current-staff-user");

afterEach(() => vi.clearAllMocks());

describe("getCurrentStaffUser — server-rendered pages get the API's database readiness guard", () => {
  it("does not touch the database without a valid session", async () => {
    cookieValue.mockReturnValue(undefined);
    await expect(getCurrentStaffUser()).resolves.toBeNull();
    cookieValue.mockReturnValue("garbage");
    verifyAuthToken.mockRejectedValueOnce(new Error("bad token"));
    await expect(getCurrentStaffUser()).resolves.toBeNull();
    expect(connectToDatabase).not.toHaveBeenCalled();
  });

  it("refuses (throws) rather than reading an unverified database — never a misleading 'not signed in'", async () => {
    cookieValue.mockReturnValue("token");
    verifyAuthToken.mockResolvedValueOnce({ sub: "s1", tokenVersion: 1 });
    connectToDatabase.mockRejectedValueOnce(new Error("Refusing to start: 8 declared index(es) are not in place."));
    await expect(getCurrentStaffUser()).rejects.toThrow(/Refusing to start/);
    expect(resolveStaffUser).not.toHaveBeenCalled();
  });

  it("checks readiness before resolving the user, and still matches the token version", async () => {
    cookieValue.mockReturnValue("token");
    verifyAuthToken.mockResolvedValue({ sub: "s1", tokenVersion: 2 });
    connectToDatabase.mockResolvedValue(undefined);
    resolveStaffUser.mockResolvedValueOnce({ _id: "s1", tokenVersion: 2, roles: [] });
    await expect(getCurrentStaffUser()).resolves.toMatchObject({ _id: "s1" });
    expect(connectToDatabase.mock.invocationCallOrder[0]).toBeLessThan(resolveStaffUser.mock.invocationCallOrder[0]!);
    resolveStaffUser.mockResolvedValueOnce({ _id: "s1", tokenVersion: 3, roles: [] });
    await expect(getCurrentStaffUser()).resolves.toBeNull();
  });
});
