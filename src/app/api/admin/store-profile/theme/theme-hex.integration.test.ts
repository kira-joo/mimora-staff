import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { StoreProfileModel } from "src/server/content/store-profile.schema";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "../../test-support/admin-route-harness";

/**
 * Route-level: the theme DTO accepts `#RGB` and `#RRGGBB`, and so does the
 * write — a three-digit colour is expanded at the boundary, measured, and
 * stored as six digits. It used to pass validation and then throw inside the
 * contrast engine, answering a valid request with a 500.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const putTheme = (await import("./route")).PUT as RouteHandler;

let admin: AdminCaller;

function body(brand: Partial<Record<"primary" | "accent" | "surface" | "text", string>> = {}, overrides: Array<{ key: "primary" | "accent"; value: string }> = []) {
  return {
    brand: { primary: "#6B8F71", accent: "#C0392B", surface: "#FFFFFF", text: "#111111", radiusScale: 1, typographyChoice: "default", ...brand },
    theme: { defaultGround: "light", darkEnabled: false, allowVisitorChoice: false, tokenOverrides: overrides },
  };
}

async function save(payload: unknown) {
  const response = await admin.call(putTheme, "/api/admin/store-profile/theme", { method: "PUT", body: payload });
  return { status: response.status, body: await response.json() };
}

const stored = async () => (await StoreProfileModel.collection.findOne({})) as { brand: Record<string, string>; theme: { tokenOverrides: Array<{ value: string }> } } | null;

beforeAll(async () => {
  await connectToDatabase();
  admin = await signInAsOwner();
});

afterAll(async () => {
  await Promise.all([removeHarnessStaff(), StoreProfileModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await StoreProfileModel.deleteMany({});
});

describe("theme colours", () => {
  it("saves a six-digit colour as given", async () => {
    const { status } = await save(body());
    expect(status).toBe(200);
    expect((await stored())?.brand.primary).toBe("#6B8F71");
  });

  it("saves three-digit colours — every brand colour and an override — expanded to six, with no 500", async () => {
    const { status, body: result } = await save(body({ primary: "#f80", accent: "#0aF", surface: "#fff", text: "#111" }, [{ key: "primary", value: "#abc" }]));
    expect(status).toBe(200);
    const saved = await stored();
    expect(saved?.brand).toMatchObject({ primary: "#ff8800", accent: "#00aaFF", surface: "#ffffff", text: "#111111" });
    expect(saved?.theme.tokenOverrides[0]?.value).toBe("#aabbcc");
    // The contrast engine measured the expanded colours — the pinned primary override, on the design's light ground.
    expect(result.contrastReport.lightGround[0]).toMatchObject({ label: "theme.tokenOverrides[primary]", fillHex: "#aabbcc", groundHex: "#F7F5F1" });
    expect(result.contrastReport.lightGround[1]).toMatchObject({ label: "brand.accent", fillHex: "#00aaFF" });
  });

  it.each(["#ffff", "#ff", "fff", "#ggg", "red", "#12345", "rgb(0,0,0)"])("refuses %s with a 400 on its field", async (bad) => {
    const { status, body: error } = await save(body({ primary: bad }));
    expect(status).toBe(400);
    expect(JSON.stringify(error)).toMatch(/primary must be a hex colour/);
  });

  it("refuses a malformed override value too", async () => {
    expect((await save(body({}, [{ key: "accent", value: "#ab" }]))).status).toBe(400);
  });
});
