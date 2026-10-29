import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { connectToDatabase } from "src/server/core/db/connect";
import { CustomerModel } from "src/server/identity/customer.schema";
import { callShopRoute, type ShopRouteHandler } from "../test-support/shop-route-harness";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { GET } = (await import("./route")) as unknown as { GET: ShopRouteHandler };

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  await CustomerModel.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
});

describe("GET /api/shop/profile — contract", () => {
  it("returns the signed-in customer's ProfileView and nothing secret", async () => {
    const customer = await CustomerModel.create({ phone: "+201000000555", email: "p@example.com", passwordHash: "secret-hash", name: "Pat", tokenVersion: 1 });

    const { status, body } = await callShopRoute(GET, "/api/shop/profile", { customerId: customer._id.toString() });

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["_id", "createdAt", "email", "emailVerified", "marketingConsent", "name", "phone", "phoneVerified", "updatedAt"]);
    expect(body.marketingConsent).toEqual({ granted: false }); // never asked is not consent
    expect(body).toMatchObject({ _id: customer._id.toString(), name: "Pat", phone: "+201000000555", email: "p@example.com", phoneVerified: false, emailVerified: false });
    expect(JSON.stringify(body)).not.toContain("secret-hash");
  });

  it("is 401 for a guest", async () => {
    const { status } = await callShopRoute(GET, "/api/shop/profile");
    expect(status).toBe(401);
  });
});
