import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { CustomerModel } from "src/server/identity/customer.schema";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Route-level: a customer's password-reset and email-verification token
 * hashes (and their expiries) must never leave the server, however the admin
 * reads the customer. The guarantee is `select: false` on the schema; these
 * tests go through the real route handlers so a projection, serializer or
 * view mapper added later cannot reintroduce the leak unnoticed.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const listCustomers = (await import("./route")).GET as RouteHandler;
const getCustomer = (await import("./[id]/route")).GET as RouteHandler;

const SECRET_FIELDS = ["passwordHash", "passwordResetTokenHash", "passwordResetExpiresAt", "emailVerificationTokenHash", "emailVerificationExpiresAt"];

/** Every key anywhere in a JSON value — a leak nested inside a wrapper counts too. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, inner]) => [key, ...allKeys(inner)]);
  return [];
}

let admin: AdminCaller;

async function get(handler: RouteHandler, path: string, params: Record<string, string> = {}) {
  const response = await admin.call(handler, path, { params });
  expect(response.status).toBe(200);
  return response.json();
}

async function seedCustomerWithTokens() {
  const customer = await CustomerModel.create({
    name: "Mona",
    phone: `+2010${Math.floor(Math.random() * 100000000)}`,
    email: `mona-${new mongoose.Types.ObjectId()}@example.com`,
    passwordHash: "argon-hash",
    passwordResetTokenHash: "reset-hash-must-not-leak",
    passwordResetExpiresAt: new Date(Date.now() + 60_000),
    emailVerificationTokenHash: "verify-hash-must-not-leak",
    emailVerificationExpiresAt: new Date(Date.now() + 60_000),
  });
  // The fixture really holds the secrets — otherwise "absent from the response" proves nothing.
  const stored = await CustomerModel.findById(customer._id).select("+passwordResetTokenHash +emailVerificationTokenHash").lean();
  expect(stored?.passwordResetTokenHash).toBe("reset-hash-must-not-leak");
  expect(stored?.emailVerificationTokenHash).toBe("verify-hash-must-not-leak");
  return customer;
}

beforeAll(async () => {
  await connectToDatabase();
  admin = await signInAsOwner();
});

afterAll(async () => {
  await Promise.all([removeHarnessStaff(), CustomerModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await CustomerModel.deleteMany({});
});

describe("customer token hashes never leave the admin API", () => {
  it("GET /api/admin/customers returns none of them", async () => {
    await seedCustomerWithTokens();
    const body = await get(listCustomers, "/api/admin/customers");
    expect(body.data).toHaveLength(1);
    for (const field of SECRET_FIELDS) expect(allKeys(body), field).not.toContain(field);
  });

  it("GET /api/admin/customers/:id returns none of them", async () => {
    const customer = await seedCustomerWithTokens();
    const body = await get(getCustomer, `/api/admin/customers/${customer._id}`, { id: customer._id.toString() });
    expect(body.customer.name).toBe("Mona");
    for (const field of SECRET_FIELDS) expect(allKeys(body), field).not.toContain(field);
  });

  it("a search cannot be used to read them either", async () => {
    await seedCustomerWithTokens();
    const body = await get(listCustomers, "/api/admin/customers?search=Mona");
    expect(body.data).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/must-not-leak/);
  });
});
