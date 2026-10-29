import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import { validateDto } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }) }));

import { connectToDatabase } from "src/server/core/db/connect";
import { CustomerModel } from "src/server/identity/customer.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { PlaceOrderDto } from "src/server/shop/dto/place-order.dto";
import { CreateAddressDto } from "src/server/shop/dto/create-address.dto";
import { CartFulfilmentAddressDto } from "src/server/shop/dto/cart-fulfilment-address.dto";
import { callShopRoute, type ShopRouteHandler } from "../test-support/shop-route-harness";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { POST: SIGNUP } = (await import("./signup/route")) as unknown as { POST: ShopRouteHandler };
const { POST: LOGIN } = (await import("./login/route")) as unknown as { POST: ShopRouteHandler };
const { POST: FORGOT } = (await import("./forgot-password/route")) as unknown as { POST: ShopRouteHandler };

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  process.env.STORE_PHONE_COUNTRY_CODE = "20";
  await Promise.all([CustomerModel.deleteMany({}), RateLimitModel.deleteMany({})]);
});
afterAll(async () => {
  delete process.env.STORE_PHONE_COUNTRY_CODE;
  await CustomerModel.deleteMany({});
  await mongoose.disconnect();
});

const post = (handler: ShopRouteHandler, path: string, body: unknown) =>
  callShopRoute(handler, path, { method: "POST", body, headers: { "idempotency-key": crypto.randomUUID() } });
const login = (phone: string, password = "correct-horse-battery") => post(LOGIN, "/api/shop/auth/login", { phone, password });

describe("phone normalisation at the customer boundaries", () => {
  it("signup stores the canonical form whatever was typed", async () => {
    expect((await post(SIGNUP, "/api/shop/auth/signup", { phone: "٠١٠٠ ٥٥٥-٠٠١١", password: "correct-horse-battery", name: "Typed" })).status).toBe(202);
    const stored = await CustomerModel.find({});
    expect(stored.map((c) => c.phone)).toEqual(["+201005550011"]);
  });

  it("signup with +20 and with the national form is one account, not two", async () => {
    await post(SIGNUP, "/api/shop/auth/signup", { phone: "01005550012", password: "correct-horse-battery", name: "A" });
    await post(SIGNUP, "/api/shop/auth/signup", { phone: "+20 100 555 0012", password: "other-password-123", name: "B" });
    await post(SIGNUP, "/api/shop/auth/signup", { phone: "00201005550012", password: "other-password-123", name: "C" });
    expect(await CustomerModel.countDocuments({})).toBe(1);
  });

  it("login works with any typed form of a canonical record", async () => {
    await CustomerModel.create({ phone: "+201005550013", passwordHash: await hashPassword("correct-horse-battery"), name: "Canon" });
    for (const typed of ["+201005550013", "01005550013", "0100 555 0013", "٠١٠٠٥٥٥٠٠١٣", "00201005550013", "+20 (100) 555-0013"]) {
      const r = await login(typed);
      expect(r.status, typed).toBe(200);
      expect(r.body.phone).toBe("+201005550013");
    }
  });

  it("login finds a LEGACY record stored as typed — nobody is locked out", async () => {
    await CustomerModel.create({ phone: "01005550014", passwordHash: await hashPassword("correct-horse-battery"), name: "Legacy" });
    for (const typed of ["01005550014", "+201005550014", "0100 555 0014"]) {
      const r = await login(typed);
      expect(r.status, typed).toBe(200);
      expect(r.body.name).toBe("Legacy");
    }
    expect((await login("01005550014", "wrong-password")).status).toBe(401);
  });

  it("login prefers the canonical record when a legacy twin also exists", async () => {
    await CustomerModel.create({ phone: "01005550015", passwordHash: await hashPassword("legacy-password-1"), name: "Legacy" });
    await CustomerModel.create({ phone: "+201005550015", passwordHash: await hashPassword("correct-horse-battery"), name: "Canonical" });
    const r = await login("01005550015");
    expect(r.status).toBe(200);
    expect(r.body.name).toBe("Canonical");
  });

  it("forgot-password matches a legacy record the same way and still answers 204 for an unknown phone", async () => {
    await CustomerModel.create({ phone: "01005550016", passwordHash: await hashPassword("x"), name: "Legacy" });
    expect((await post(FORGOT, "/api/shop/auth/forgot-password", { identifier: "+201005550016" })).status).toBe(204);
    const stored = await CustomerModel.findOne({ phone: "01005550016" }).select("+passwordResetTokenHash");
    expect(stored?.passwordResetTokenHash).toBeTruthy();
    expect((await post(FORGOT, "/api/shop/auth/forgot-password", { identifier: "+201005559998" })).status).toBe(204);
  });

  it("guest order contact is canonical after DTO validation", async () => {
    const dto = await validateDto(PlaceOrderDto, {
      paymentMethod: "COD",
      termsVersionAccepted: 1,
      guestContact: { name: "Guest", phone: "٠١٠٠ ٥٥٥ ٠٠١٧", email: "g@example.com" },
    }).catch((e) => e);
    if (dto instanceof Error) throw dto;
    expect(dto.guestContact?.phone).toBe("+201005550017");
  });

  it("address phones (customer address, cart delivery address) are canonical; letters are rejected", async () => {
    const address = { recipientName: "R", phone: "0100 555 0018", addressLine1: "1 St", city: "Cairo", governorate: "Cairo" };
    expect((await validateDto(CreateAddressDto, { ...address, label: "Home" })).phone).toBe("+201005550018");
    expect((await validateDto(CartFulfilmentAddressDto, address)).phone).toBe("+201005550018");
    await expect(validateDto(CreateAddressDto, { ...address, label: "Home", phone: "0100abc0018" })).rejects.toThrow();
  });
});
