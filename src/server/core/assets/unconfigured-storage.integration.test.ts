import { ServiceUnavailableError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../db/connect";
import { OrderModel } from "../../commerce/order.schema";
import { listPaymentQueue } from "../../admin/payments/list-payment-queue";
import { privateAssets } from "./asset-providers";

/*
 * Without Cloudinary credentials (restaurant-platform-staff convention, 2026-10-22): an upload is a
 * 503 with a message a customer can act on — never a bare 500 — and the staff payment queue still
 * answers when there is nothing to sign.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
for (const name of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) delete process.env[name];

beforeAll(async () => {
  await connectToDatabase();
  await OrderModel.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
});

describe("receipt storage not configured", () => {
  it("refuses with 503 and a customer-safe message that names no configuration", () => {
    let caught: unknown;
    try {
      privateAssets();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableError);
    expect((caught as Error).message).not.toMatch(/CLOUDINARY|secret|key/i);
  });

  it("still lists the (empty) payment queue instead of failing it", async () => {
    const result = await listPaymentQueue({ page: 1, limit: 20 } as never);
    expect(result.data).toEqual([]);
  });
});
