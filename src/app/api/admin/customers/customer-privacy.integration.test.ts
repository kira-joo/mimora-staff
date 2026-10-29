import mongoose from "mongoose";
import { Decimal } from "decimal.js";
import { toMoney } from "@kira-joo/toolkit-common";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import { issueRefreshToken, rotateRefreshToken } from "@kira-joo/backend-toolkit-mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AddressModel } from "src/server/core/address.schema";
import { ActivityLogModel } from "src/server/core/activity-log.schema";
import { CartModel } from "src/server/commerce/cart.schema";
import { CartLineModel } from "src/server/commerce/cart-line.schema";
import { OrderModel } from "src/server/commerce/order.schema";
import { WishlistModel, buildWishlistKey } from "src/server/commerce/wishlist.schema";
import { ReviewModel, buildReviewKey } from "src/server/content/review.schema";
import { ConsentEventModel } from "src/server/identity/consent-event.schema";
import { CustomerModel } from "src/server/identity/customer.schema";
import { CustomerRefreshTokenModel } from "src/server/identity/customer-refresh-token.schema";
import { NewsletterSubscriberModel } from "src/server/newsletter/newsletter-subscriber.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { IdempotencyRecordModel } from "src/server/commerce/idempotency-record.schema";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { hashVerificationToken } from "src/server/shop/auth/hash-verification-token";
import { signupCustomer } from "src/server/shop/auth/signup";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type RouteHandler } from "../test-support/admin-route-harness";
import { callShopRoute, type ShopRouteHandler } from "../../shop/test-support/shop-route-harness";

vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined), delete: () => undefined }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";

const exportData = (await import("./[id]/export/route")).GET as RouteHandler;
const redact = (await import("./[id]/redact/route")).POST as RouteHandler;
const resetLink = (await import("./[id]/reset-link/route")).POST as RouteHandler;
const detail = (await import("./[id]/route")).GET as RouteHandler;
const login = (await import("../../shop/auth/login/route")).POST as unknown as ShopRouteHandler;
const resetPassword = (await import("../../shop/auth/reset-password/route")).POST as unknown as ShopRouteHandler;
const forgot = (await import("../../shop/auth/forgot-password/route")).POST as unknown as ShopRouteHandler;
const profile = (await import("../../shop/profile/route")).GET as unknown as ShopRouteHandler;

const COLLECTIONS = [CustomerModel, CustomerRefreshTokenModel, AddressModel, CartModel, CartLineModel, WishlistModel, ReviewModel, OrderModel, NewsletterSubscriberModel, ConsentEventModel, ActivityLogModel, RateLimitModel, IdempotencyRecordModel];
const wipe = () => Promise.all(COLLECTIONS.map((model) => (model as unknown as mongoose.Model<unknown>).deleteMany({})));

const PHONE = "+201005550400";
const EMAIL = "mona.private@example.com";
const REDACT_BODY = { reason: "CUSTOMER_REQUEST", confirm: "REDACT" };

async function seedCustomer() {
  const customer = await CustomerModel.create({
    phone: PHONE,
    email: EMAIL,
    name: "Mona Private",
    passwordHash: await hashPassword("right-password"),
    emailVerified: true,
    passwordResetTokenHash: "reset-hash",
    passwordResetExpiresAt: new Date(Date.now() + 60_000),
    marketingConsent: { granted: true, at: new Date(), source: "signup" },
  });
  const customerId = customer._id;
  const productId = new mongoose.Types.ObjectId();
  const session = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId: customerId, ttlMs: 3_600_000 });
  await AddressModel.create({ customerId, label: "Home", recipientName: "Mona Private", phone: PHONE, addressLine1: "1 Secret St", city: "Cairo", governorate: "Cairo" });
  const cart = await CartModel.create({ customerId });
  await CartLineModel.create({ cartId: cart._id, variantId: new mongoose.Types.ObjectId(), quantity: 1, lineIdentityKey: `${cart._id}|v|` });
  await WishlistModel.create({ customerId, productId, customerProductKey: buildWishlistKey(customerId, productId) });
  await ReviewModel.create({ customerId, productId, customerProductKey: buildReviewKey(customerId, productId), rating: 5, title: { ar: "ممتاز", en: "Great" }, body: { ar: "جيد", en: "Good" }, status: "APPROVED" });
  await NewsletterSubscriberModel.create({ email: EMAIL, source: "signup", status: "SUBSCRIBED", consentedAt: new Date(), customerId });
  await ConsentEventModel.create({ customerId, granted: true, source: "signup", at: new Date() });
  const order = await OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    customerId,
    status: "DELIVERED",
    placedAt: new Date(),
    subtotal: new Decimal("100.00"),
    total: new Decimal("100.00"),
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    payment: { method: "COD", status: "VERIFIED" },
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
  });
  return { customer, session, order };
}

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  process.env.STORE_PHONE_COUNTRY_CODE = "20";
  await wipe();
  await removeHarnessStaff();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  delete process.env.STORE_PHONE_COUNTRY_CODE;
  await wipe();
  await removeHarnessStaff();
  await mongoose.disconnect();
});

const call = (caller: Awaited<ReturnType<typeof signInAsOwner>>, handler: RouteHandler, id: string, method = "GET", body?: unknown) =>
  caller.call(handler, `/api/admin/customers/${id}`, { method, body, params: { id } });

describe("POST /api/admin/customers/:id/redact", () => {
  it("redacts the account and its personal data in one commit, and leaves orders and the order snapshot intact", async () => {
    const { customer, session, order } = await seedCustomer();
    const orderBefore = JSON.stringify(await OrderModel.findById(order._id).lean());
    const owner = await signInAsOwner();

    const response = await call(owner, redact, customer._id.toString(), "POST", REDACT_BODY);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["_id", "redactedAt"]);

    const after = await CustomerModel.findById(customer._id).select("+passwordHash +passwordResetTokenHash +passwordResetExpiresAt +emailVerificationTokenHash").lean();
    expect(after?.name).toBe("Deleted customer");
    expect(after?.phone).toBe(`redacted:${customer._id}`);
    expect(after?.email).toBeUndefined();
    expect(after?.emailVerified).toBe(false);
    expect(after?.phoneVerified).toBe(false);
    expect(after?.passwordResetTokenHash).toBeUndefined();
    expect(after?.passwordResetExpiresAt).toBeUndefined();
    expect(after?.passwordHash).not.toBe((await CustomerModel.findOne({ _id: new mongoose.Types.ObjectId() }))?.passwordHash);
    expect(after?.tokenVersion).toBe(2);
    expect(after?.redactedAt).toBeInstanceOf(Date);
    expect(after?.marketingConsent?.granted).toBe(false);

    await expect(rotateRefreshToken(CustomerRefreshTokenModel, session.token, 3_600_000)).rejects.toThrow();
    expect(await AddressModel.countDocuments({ customerId: customer._id })).toBe(0);
    expect(await CartModel.countDocuments({ customerId: customer._id })).toBe(0);
    expect(await CartLineModel.countDocuments({})).toBe(0);
    expect(await WishlistModel.countDocuments({ customerId: customer._id })).toBe(0);
    expect(await NewsletterSubscriberModel.countDocuments({})).toBe(0);

    // Kept: the order document byte-for-byte, the review, and the consent record (now with the withdrawal).
    expect(JSON.stringify(await OrderModel.findById(order._id).lean())).toBe(orderBefore);
    expect(await OrderModel.countDocuments({ customerId: customer._id })).toBe(1);
    expect(await ReviewModel.countDocuments({ customerId: customer._id })).toBe(1);
    expect(await ConsentEventModel.find({ customerId: customer._id }).sort({ at: 1 }).lean().then((rows) => rows.map((r) => r.granted))).toEqual([true, false]);
  });

  it("is audited in the activity log with the opaque id and reason code — and nothing personal", async () => {
    const { customer } = await seedCustomer();
    const owner = await signInAsOwner();
    await call(owner, redact, customer._id.toString(), "POST", REDACT_BODY);

    const entries = await ActivityLogModel.find({ entityType: "Customer", action: "redact" }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entityId?.toString()).toBe(customer._id.toString());
    expect(entries[0]!.changes).toEqual({ reason: "CUSTOMER_REQUEST", confirm: "REDACT" });
    const serialised = JSON.stringify(entries);
    for (const personal of ["Mona", PHONE, EMAIL, "Secret"]) expect(serialised).not.toContain(personal);
  });

  it("rolls back as a whole: a failure on the last step leaves NO partial state", async () => {
    const { customer, session } = await seedCustomer();
    const owner = await signInAsOwner();
    const snapshot = JSON.stringify(await CustomerModel.findById(customer._id).select("+passwordHash").lean());
    // The newsletter delete is the transaction's final write; failing it proves every earlier write was undone.
    vi.spyOn(NewsletterSubscriberModel, "deleteMany").mockImplementation((() => {
      throw new Error("boom");
    }) as never);

    const response = await call(owner, redact, customer._id.toString(), "POST", REDACT_BODY);
    expect(response.status).toBeGreaterThanOrEqual(500);

    expect(JSON.stringify(await CustomerModel.findById(customer._id).select("+passwordHash").lean())).toBe(snapshot);
    expect(await AddressModel.countDocuments({ customerId: customer._id })).toBe(1);
    expect(await CartModel.countDocuments({ customerId: customer._id })).toBe(1);
    expect(await CartLineModel.countDocuments({})).toBe(1);
    expect(await WishlistModel.countDocuments({ customerId: customer._id })).toBe(1);
    expect(await NewsletterSubscriberModel.countDocuments({})).toBe(1);
    expect(await ConsentEventModel.countDocuments({ customerId: customer._id })).toBe(1);
    expect(await CustomerRefreshTokenModel.countDocuments({ subjectId: customer._id, revokedAt: { $exists: true } })).toBe(0);
    await expect(rotateRefreshToken(CustomerRefreshTokenModel, session.token, 3_600_000)).resolves.toBeDefined();
  });

  it("requires Customer.redact: a holder of every OTHER customer permission is refused, and nothing changes", async () => {
    const { customer } = await seedCustomer();
    const nearlyEverything = await signInWithPermissions([
      AppPermission.CUSTOMER.READ, AppPermission.CUSTOMER.READ_ONE, AppPermission.CUSTOMER.UPDATE, AppPermission.CUSTOMER.DELETE,
      CustomPermission.CUSTOMER_EXPORT_DATA, CustomPermission.CUSTOMER_RESET_LINK, CustomPermission.CUSTOMER_EXPORT,
    ]);
    const response = await call(nearlyEverything, redact, customer._id.toString(), "POST", REDACT_BODY);
    expect(response.status).toBe(403);
    expect((await CustomerModel.findById(customer._id).lean())?.redactedAt).toBeUndefined();
    expect(await AddressModel.countDocuments({})).toBe(1);
  });

  it("needs a reason from the closed list and the literal confirmation", async () => {
    const { customer } = await seedCustomer();
    const owner = await signInAsOwner();
    for (const body of [{}, { reason: "CUSTOMER_REQUEST" }, { confirm: "REDACT" }, { reason: "because Mona asked", confirm: "REDACT" }, { reason: "OTHER", confirm: "yes" }]) {
      expect((await call(owner, redact, customer._id.toString(), "POST", body)).status).toBe(400);
    }
    expect((await CustomerModel.findById(customer._id).lean())?.redactedAt).toBeUndefined();
  });

  it("a second redaction is a 409, an unknown customer a 404", async () => {
    const { customer } = await seedCustomer();
    const owner = await signInAsOwner();
    expect((await call(owner, redact, customer._id.toString(), "POST", REDACT_BODY)).status).toBe(200);
    expect((await call(owner, redact, customer._id.toString(), "POST", REDACT_BODY)).status).toBe(409);
    expect((await call(owner, redact, new mongoose.Types.ObjectId().toString(), "POST", REDACT_BODY)).status).toBe(404);
  });

  it("a redacted customer cannot sign in or recover the account — not by the old phone, nor by typing the placeholder", async () => {
    const { customer } = await seedCustomer();
    const owner = await signInAsOwner();
    await call(owner, redact, customer._id.toString(), "POST", REDACT_BODY);

    for (const phone of [PHONE, `redacted:${customer._id}`]) {
      const attempt = await callShopRoute(login, "/api/shop/auth/login", { method: "POST", body: { phone, password: "right-password" }, headers: { "x-forwarded-for": "10.40.0.1" } });
      expect(attempt.status).toBe(401);
    }
    await callShopRoute(forgot, "/api/shop/auth/forgot-password", { method: "POST", body: { identifier: `redacted:${customer._id}` }, headers: { "x-forwarded-for": "10.40.0.2", "idempotency-key": crypto.randomUUID() } });
    expect((await CustomerModel.findById(customer._id).select("+passwordResetTokenHash").lean())?.passwordResetTokenHash).toBeUndefined();
    // And a session issued before the redaction is dead.
    expect((await callShopRoute(profile, "/api/shop/profile", { customerId: customer._id.toString() })).status).toBe(401);
  });

  it("the phone and email can be registered again by a new signup, which becomes a separate account", async () => {
    const { customer } = await seedCustomer();
    const owner = await signInAsOwner();
    await call(owner, redact, customer._id.toString(), "POST", REDACT_BODY);

    await signupCustomer({ phone: PHONE, email: EMAIL, password: "new-password-1", name: "New Owner" });
    const fresh = await CustomerModel.findOne({ phone: PHONE }).lean();
    expect(fresh?._id.toString()).not.toBe(customer._id.toString());
    expect(fresh?.email).toBe(EMAIL);
    const ok = await callShopRoute(login, "/api/shop/auth/login", { method: "POST", body: { phone: PHONE, password: "new-password-1" }, headers: { "x-forwarded-for": "10.40.0.3" } });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("New Owner");
  });
});

describe("GET /api/admin/customers/:id/export", () => {
  it("returns the customer's personal data and no credential", async () => {
    const { customer } = await seedCustomer();
    const owner = await signInAsOwner();
    const response = await call(owner, exportData, customer._id.toString());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.customer).toMatchObject({ name: "Mona Private", phone: PHONE, email: EMAIL });
    expect(body.addresses).toHaveLength(1);
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0]).toMatchObject({ status: "DELIVERED", total: "100.00" });
    expect(body.reviews).toHaveLength(1);
    expect(body.wishlist).toHaveLength(1);
    expect(body.marketingConsent.current).toMatchObject({ granted: true, source: "signup" });
    expect(body.marketingConsent.history).toHaveLength(1);
    expect(body.newsletter).toMatchObject({ status: "SUBSCRIBED" });
    const text = JSON.stringify(body);
    for (const secret of ["passwordHash", "reset-hash", "tokenVersion", "TokenHash"]) expect(text).not.toContain(secret);
  });

  it("is permissioned (Customer.readOne alone is refused) and audited without the data", async () => {
    const { customer } = await seedCustomer();
    const reader = await signInWithPermissions([AppPermission.CUSTOMER.READ, AppPermission.CUSTOMER.READ_ONE]);
    expect((await call(reader, exportData, customer._id.toString())).status).toBe(403);

    const exporter = await signInWithPermissions([CustomPermission.CUSTOMER_EXPORT_DATA]);
    expect((await call(exporter, exportData, customer._id.toString())).status).toBe(200);
    const entries = await ActivityLogModel.find({ entityType: "Customer", action: "exportData" }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entityId?.toString()).toBe(customer._id.toString());
    expect(JSON.stringify(entries)).not.toContain("Mona");
  });
});

describe("POST /api/admin/customers/:id/reset-link", () => {
  it("mints a reset credential with the same hashing and one-hour lifetime as forgot-password, shown once, redeemable at reset-password", async () => {
    const { customer } = await seedCustomer();
    const owner = await signInAsOwner();
    const response = await call(owner, resetLink, customer._id.toString(), "POST");
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.resetPath).toBe(`/reset-password?token=${body.token}`);
    const stored = await CustomerModel.findById(customer._id).select("+passwordResetTokenHash +passwordResetExpiresAt").lean();
    expect(stored?.passwordResetTokenHash).toBe(hashVerificationToken(body.token));
    expect(JSON.stringify(stored)).not.toContain(body.token);
    const ttl = stored!.passwordResetExpiresAt!.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60_000);
    expect(ttl).toBeLessThanOrEqual(60 * 60_000);

    const reset = await callShopRoute(resetPassword, "/api/shop/auth/reset-password", { method: "POST", body: { token: body.token, newPassword: "brand-new-password" }, headers: { "idempotency-key": crypto.randomUUID() } });
    expect(reset.status).toBe(204);
    const signedIn = await callShopRoute(login, "/api/shop/auth/login", { method: "POST", body: { phone: PHONE, password: "brand-new-password" }, headers: { "x-forwarded-for": "10.40.0.4" } });
    expect(signedIn.status).toBe(200);
  });

  it("never lands in the audit trail, and a re-mint cancels the previous credential", async () => {
    const { customer } = await seedCustomer();
    const owner = await signInAsOwner();
    const first = await (await call(owner, resetLink, customer._id.toString(), "POST")).json();
    const second = await (await call(owner, resetLink, customer._id.toString(), "POST")).json();
    expect(first.token).not.toBe(second.token);
    const entries = await ActivityLogModel.find({ entityType: "Customer", action: "createResetLink" }).lean();
    expect(entries).toHaveLength(2);
    expect(JSON.stringify(entries)).not.toContain(first.token);
    expect(JSON.stringify(entries)).not.toContain(second.token);
    const reuse = await callShopRoute(resetPassword, "/api/shop/auth/reset-password", { method: "POST", body: { token: first.token, newPassword: "brand-new-password" }, headers: { "idempotency-key": crypto.randomUUID() } });
    expect(reuse.status).toBe(401);
  });

  it("requires Customer.createResetLink — a customer reader and a data exporter are refused, and no credential is minted", async () => {
    const { customer } = await seedCustomer();
    const lesser = await signInWithPermissions([AppPermission.CUSTOMER.READ_ONE, AppPermission.CUSTOMER.UPDATE, CustomPermission.CUSTOMER_EXPORT_DATA, CustomPermission.CUSTOMER_REDACT]);
    expect((await call(lesser, resetLink, customer._id.toString(), "POST")).status).toBe(403);
    expect((await CustomerModel.findById(customer._id).select("+passwordResetTokenHash").lean())?.passwordResetTokenHash).toBe("reset-hash");
  });

  it("refuses a redacted customer", async () => {
    const { customer } = await seedCustomer();
    const owner = await signInAsOwner();
    await call(owner, redact, customer._id.toString(), "POST", REDACT_BODY);
    expect((await call(owner, resetLink, customer._id.toString(), "POST")).status).toBe(409);
  });
});

describe("GET /api/admin/customers/:id — consent state", () => {
  it("shows the current consent, its history and the newsletter state", async () => {
    const { customer } = await seedCustomer();
    const owner = await signInAsOwner();
    const body = await (await call(owner, detail, customer._id.toString())).json();
    expect(body.marketingConsent).toMatchObject({ granted: true, source: "signup" });
    expect(body.consentEvents).toHaveLength(1);
    expect(body.newsletter).toMatchObject({ status: "SUBSCRIBED" });
  });
});
