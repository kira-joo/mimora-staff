import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";
import { imageForm, makePng } from "../test-support/image-fixtures";

/**
 * A capability configured OFF must say so. With no Cloudinary credentials an upload answers 503 with a message a
 * staff member can act on — never a bare 500, never configuration details, and never a 400 that blames the file.
 * The REAL provider module runs here (no stub): this is the `requireEnv` path.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";
for (const name of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) delete process.env[name];

const postProduct = (await import("./product-images/route")).POST as RouteHandler;
let owner: AdminCaller;

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await removeHarnessStaff();
  await mongoose.disconnect();
});

describe("uploads with storage not configured", () => {
  it("answers 503 with a message that names no configuration", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await owner.call(postProduct, "/api/admin/media/product-images", { method: "POST", body: imageForm(makePng(300, 300)) });
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).toMatch(/cannot accept file uploads/i);
    expect(text).not.toMatch(/CLOUDINARY|secret|api key/i);
    // The variable's NAME goes to the server log, which is where an operator looks.
    expect(error.mock.calls.flat().join(" ")).toContain("CLOUDINARY_CLOUD_NAME");
    error.mockRestore();
  });

  it("still refuses a bad file with 400 first — validation does not need storage", async () => {
    const response = await owner.call(postProduct, "/api/admin/media/product-images", { method: "POST", body: imageForm(makePng(50, 50)) });
    expect(response.status).toBe(400);
  });
});
