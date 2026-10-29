import mongoose from "mongoose";
import { Decimal } from "decimal.js";
import { toMoney } from "@kira-joo/toolkit-common";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { OrderModel } from "src/server/commerce/order.schema";
import { PaymentSettingsModel } from "src/server/fulfilment/payment-settings.schema";
import type { RouteHandler } from "../../../admin/test-support/admin-route-harness";

/**
 * The scheduler's entry point: `auth: false` (no staff session) authenticated by the shared JOBS_SECRET. The negative
 * cases are the point — no secret configured, no secret presented, a wrong one: each is a 404 and sweeps NOTHING.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const routes = await import("./route");
const post = routes.POST as RouteHandler;
const get = routes.GET as RouteHandler;
const SECRET = "integration-test-jobs-secret-0123456789";
const originalSecret = process.env.JOBS_SECRET;
const originalCronSecret = process.env.CRON_SECRET;

const call = (headers: Record<string, string> = {}) => post(new NextRequest("http://localhost/api/internal/jobs/expire-unpaid-orders", { method: "POST", headers }), { params: Promise.resolve({}) });

async function seedExpiredOrder() {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    status: "PLACED",
    placedAt: new Date(Date.now() - 3 * 60 * 60_000),
    subtotal: new Decimal("10.00"),
    total: new Decimal("10.00"),
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    payment: { method: "WALLET_TRANSFER", status: "AWAITING_PAYMENT" },
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
  });
}

beforeAll(async () => {
  await connectToDatabase();
});
afterAll(async () => {
  await Promise.all([OrderModel.deleteMany({}), PaymentSettingsModel.deleteMany({})]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([OrderModel.deleteMany({}), PaymentSettingsModel.deleteMany({})]);
  await PaymentSettingsModel.create({ methods: [{ method: "WALLET_TRANSFER", enabled: true, order: 0, requiresProof: true, autoCancelMinutes: 60 }] });
});
const callGet = (headers: Record<string, string> = {}) => get(new NextRequest("http://localhost/api/internal/jobs/expire-unpaid-orders", { method: "GET", headers }), { params: Promise.resolve({}) });

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JOBS_SECRET;
  else process.env.JOBS_SECRET = originalSecret;
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

describe("POST /api/internal/jobs/expire-unpaid-orders", () => {
  it("with the secret: sweeps, answers 200 with the result", async () => {
    process.env.JOBS_SECRET = SECRET;
    const order = await seedExpiredOrder();

    const response = await call({ "x-jobs-secret": SECRET });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cancelled: [order.orderNumber], failed: [], methodsSwept: ["WALLET_TRANSFER"] });
    expect((await OrderModel.findById(order._id).lean())?.status).toBe("CANCELLED");
  });

  it("accepts the secret as a Bearer token too", async () => {
    process.env.JOBS_SECRET = SECRET;
    await seedExpiredOrder();
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(200);
  });

  it("is safe to fire twice: the second sweep cancels nothing", async () => {
    process.env.JOBS_SECRET = SECRET;
    await seedExpiredOrder();

    await call({ "x-jobs-secret": SECRET });
    const second = await call({ "x-jobs-secret": SECRET });

    expect((await second.json()).cancelled).toEqual([]);
  });

  it.each([
    ["no credential", {}],
    ["a wrong secret", { "x-jobs-secret": "wrong" }],
    ["a wrong bearer token", { authorization: "Bearer wrong" }],
  ])("NEGATIVE: %s is a 404 and sweeps nothing", async (_label, headers) => {
    process.env.JOBS_SECRET = SECRET;
    const order = await seedExpiredOrder();

    const response = await call(headers);

    expect(response.status).toBe(404);
    expect((await OrderModel.findById(order._id).lean())?.status).toBe("PLACED");
  });

  it("NEGATIVE: with JOBS_SECRET unset, EVERY caller gets a 404 — even one presenting an empty value", async () => {
    delete process.env.JOBS_SECRET;
    const order = await seedExpiredOrder();

    const attempts: Record<string, string>[] = [{}, { "x-jobs-secret": "" }, { "x-jobs-secret": "anything" }, { authorization: "Bearer " }];
    for (const headers of attempts) {
      expect((await call(headers)).status).toBe(404);
    }
    expect((await OrderModel.findById(order._id).lean())?.status).toBe("PLACED");
  });
});

describe("Vercel Cron: GET with Authorization: Bearer $CRON_SECRET", () => {
  it("sweeps when only CRON_SECRET is configured (no JOBS_SECRET to keep in step)", async () => {
    delete process.env.JOBS_SECRET;
    process.env.CRON_SECRET = SECRET;
    const order = await seedExpiredOrder();

    const response = await callGet({ authorization: `Bearer ${SECRET}` });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cancelled: [order.orderNumber] });
    expect((await OrderModel.findById(order._id).lean())?.status).toBe("CANCELLED");
  });

  it("POST also accepts CRON_SECRET", async () => {
    delete process.env.JOBS_SECRET;
    process.env.CRON_SECRET = SECRET;
    await seedExpiredOrder();
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(200);
  });

  it.each([
    ["no credential", {}],
    ["a wrong bearer token", { authorization: "Bearer wrong" }],
  ])("NEGATIVE: GET with %s is a 404 and sweeps nothing", async (_label, headers) => {
    process.env.CRON_SECRET = SECRET;
    const order = await seedExpiredOrder();
    expect((await callGet(headers)).status).toBe(404);
    expect((await OrderModel.findById(order._id).lean())?.status).toBe("PLACED");
  });

  it("NEGATIVE: with neither secret set, GET is a 404 for everyone", async () => {
    delete process.env.JOBS_SECRET;
    delete process.env.CRON_SECRET;
    const order = await seedExpiredOrder();
    const attempts: Record<string, string>[] = [{}, { authorization: "Bearer " }, { authorization: `Bearer ${SECRET}` }];
    for (const headers of attempts) expect((await callGet(headers)).status).toBe(404);
    expect((await OrderModel.findById(order._id).lean())?.status).toBe("PLACED");
  });
});
