import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { PromotionModel } from "src/server/commerce/promotion.schema";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Route-level contract for promotions: the value is an exact decimal (sent
 * and returned as a string, stored as Decimal128), and every optional field
 * has three distinct update states — omitted (unchanged), null (cleared), a
 * value (set).
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const createRoute = (await import("./route")).POST as RouteHandler;
const { GET: getRoute, PUT: putRoute } = (await import("./[id]/route")) as unknown as Record<"GET" | "PUT", RouteHandler>;

const LOCALIZED = { en: "Summer", ar: "الصيف" };
let admin: AdminCaller;

async function create(body: Record<string, unknown>) {
  const response = await admin.call(createRoute, "/api/admin/promotions", { method: "POST", body: { name: LOCALIZED, description: LOCALIZED, conditions: {}, ...body } });
  return { status: response.status, body: await response.json() };
}

async function update(id: string, body: Record<string, unknown>) {
  const response = await admin.call(putRoute, `/api/admin/promotions/${id}`, { method: "PUT", body, params: { id } });
  return { status: response.status, body: await response.json() };
}

async function read(id: string) {
  return (await admin.call(getRoute, `/api/admin/promotions/${id}`, { params: { id } })).json();
}

/** What is actually at rest — bypassing every schema getter. */
async function raw(id: string) {
  return PromotionModel.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
}

beforeAll(async () => {
  await connectToDatabase();
  admin = await signInAsOwner();
});

afterAll(async () => {
  await Promise.all([removeHarnessStaff(), PromotionModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await PromotionModel.deleteMany({});
});

describe("value — an exact decimal, never a float", () => {
  it("stores a FIXED value as Decimal128 and returns it as the same decimal string", async () => {
    const { status, body } = await create({ type: "FIXED", value: "49.99" });
    expect(status).toBe(201);
    expect(body.value).toBe("49.99");
    const stored = await raw(body._id);
    expect(stored?.value?._bsontype).toBe("Decimal128");
    expect(stored?.value?.toString()).toBe("49.99");
    expect((await read(body._id)).value).toBe("49.99");
  });

  it("refuses a value that is not a non-negative decimal string", async () => {
    expect((await create({ type: "FIXED", value: 49.99 })).status).toBe(400);
    expect((await create({ type: "FIXED", value: "-5" })).status).toBe(400);
    expect((await create({ type: "FIXED", value: "1.999" })).status).toBe(400);
  });

  it("requires a value for PERCENT and FIXED", async () => {
    expect((await create({ type: "PERCENT" })).status).toBe(400);
    expect((await create({ type: "FIXED" })).status).toBe(400);
  });

  it("keeps zero as a value, distinct from absence", async () => {
    const { status, body } = await create({ type: "FIXED", value: "0" });
    expect(status).toBe(201);
    expect(Number.isNaN(Number(body.value))).toBe(false);
    expect((await raw(body._id))?.value?.toString()).toBe("0.00"); // stored at the money scale
  });

  it("stores no value for FREE_SHIPPING, even if one is sent", async () => {
    const { body } = await create({ type: "FREE_SHIPPING", value: "10" });
    expect(body.value).toBeUndefined();
    expect(await raw(body._id)).not.toHaveProperty("value");
  });

  it("refuses a PERCENT above 100, compared exactly", async () => {
    expect((await create({ type: "PERCENT", value: "100.01" })).status).toBe(409);
    expect((await create({ type: "PERCENT", value: "100" })).status).toBe(201);
  });
});

describe("value — update", () => {
  it("changes a fixed value", async () => {
    const { body } = await create({ type: "FIXED", value: "10" });
    const updated = await update(body._id, { value: "12.50" });
    expect(updated.status).toBe(200);
    expect(updated.body.value).toBe("12.5");
    expect((await raw(body._id))?.value?.toString()).toBe("12.50");
  });

  it("refuses to clear the value of a FIXED promotion", async () => {
    const { body } = await create({ type: "FIXED", value: "10" });
    expect((await update(body._id, { value: null })).status).toBe(400);
    expect((await raw(body._id))?.value?.toString()).toBe("10.00");
  });

  it("clears the value when the promotion becomes FREE_SHIPPING", async () => {
    const { body } = await create({ type: "FIXED", value: "10" });
    const updated = await update(body._id, { type: "FREE_SHIPPING", value: null });
    expect(updated.status).toBe(200);
    expect(await raw(body._id)).not.toHaveProperty("value");
    // A type change alone drops it too — a free-shipping promotion never carries a stale amount.
    const other = await create({ type: "FIXED", value: "10" });
    await update(other.body._id, { type: "FREE_SHIPPING" });
    expect(await raw(other.body._id)).not.toHaveProperty("value");
  });

  it("requires a value when a FREE_SHIPPING promotion becomes FIXED", async () => {
    const { body } = await create({ type: "FREE_SHIPPING" });
    expect((await update(body._id, { type: "FIXED" })).status).toBe(400);
    expect((await update(body._id, { type: "FIXED", value: "5" })).status).toBe(200);
  });

  it("leaves the value alone when a different field changes", async () => {
    const { body } = await create({ type: "PERCENT", value: "15" });
    await update(body._id, { active: false });
    expect((await raw(body._id))?.value?.toString()).toBe("15.00");
  });
});

describe("limits — omitted keeps, null clears, a number sets", () => {
  it("sets, changes one, and clears one without touching the other", async () => {
    const { body } = await create({ type: "PERCENT", value: "10", limits: { totalUses: 100, perCustomerUses: 1 } });
    await update(body._id, { limits: { perCustomerUses: 2 } });
    expect((await raw(body._id))?.limits).toEqual({ totalUses: 100, perCustomerUses: 2 });

    await update(body._id, { limits: { totalUses: null } });
    const stored = await raw(body._id);
    expect(stored?.limits).toEqual({ perCustomerUses: 2 });
    // Absent, not null — a null limit must never reach the engine as "zero uses left".
    expect(stored?.limits).not.toHaveProperty("totalUses");
  });

  it("still refuses a limit below 1", async () => {
    const { body } = await create({ type: "PERCENT", value: "10" });
    expect((await update(body._id, { limits: { totalUses: 0 } })).status).toBe(400);
  });
});

describe("code — clearable, making the promotion automatic", () => {
  it("removes the code on null or an empty string, and two codeless promotions coexist", async () => {
    const first = await create({ type: "PERCENT", value: "10", code: "SUMMER" });
    const second = await create({ type: "PERCENT", value: "5", code: "WINTER" });
    expect((await update(first.body._id, { code: null })).status).toBe(200);
    expect((await update(second.body._id, { code: "  " })).status).toBe(200);
    expect(await raw(first.body._id)).not.toHaveProperty("code");
    expect(await raw(second.body._id)).not.toHaveProperty("code");
  });

  it("an omitted code stays", async () => {
    const { body } = await create({ type: "PERCENT", value: "10", code: "SUMMER" });
    await update(body._id, { value: "11" });
    expect((await raw(body._id))?.code).toBe("SUMMER");
  });
});

describe("conditions — editing one never erases the others", () => {
  const startsAt = "2026-10-01T06:00:00.000Z";
  const endsAt = "2026-10-31T21:00:00.000Z";

  it("keeps the minimum and start date when only the end date changes", async () => {
    const { body } = await create({ type: "PERCENT", value: "10", conditions: { minSubtotal: "200", startsAt, endsAt } });
    await update(body._id, { conditions: { endsAt: "2026-11-30T21:00:00.000Z" } });
    const stored = await raw(body._id);
    expect(stored?.conditions.minSubtotal.toString()).toBe("200.00");
    expect(stored?.conditions.startsAt.toISOString()).toBe(startsAt);
    expect(stored?.conditions.endsAt.toISOString()).toBe("2026-11-30T21:00:00.000Z");
  });

  it("clears the end date and the minimum on null", async () => {
    const { body } = await create({ type: "PERCENT", value: "10", conditions: { minSubtotal: "200", startsAt, endsAt } });
    await update(body._id, { conditions: { endsAt: null, minSubtotal: null } });
    const stored = await raw(body._id);
    expect(stored?.conditions).not.toHaveProperty("endsAt");
    expect(stored?.conditions).not.toHaveProperty("minSubtotal");
    expect(stored?.conditions.startsAt.toISOString()).toBe(startsAt);
  });
});
