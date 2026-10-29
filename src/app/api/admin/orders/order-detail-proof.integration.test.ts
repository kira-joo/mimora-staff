import mongoose from "mongoose";
import { Decimal } from "decimal.js";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { OrderModel } from "src/server/commerce/order.schema";
import { PaymentProofModel } from "src/server/commerce/payment-proof.schema";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * The admin order detail carries the customer's payment proof — with a freshly minted signed link — to a caller who
 * holds Payment.verify, and to nobody else (order-read is held by every fulfilment and support role; a receipt is bank
 * data). It stays viewable after the proof is verified or rejected. A stored URL is never returned: the stub below mints
 * a different link on every call, and the proof document has no URL field at all.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});
let mintCount = 0;
vi.mock("src/server/core/assets/asset-providers", () => ({
  privateAssets: () => ({ signedUrl: (asset: { publicId: string }, ttl: number) => `https://signed.example/${asset.publicId}?n=${++mintCount}&ttl=${ttl}` }),
}));

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const getDetail = (await import("./[id]/route")).GET as RouteHandler;
const putVerify = (await import("./[id]/payment/verify/route")).PUT as RouteHandler;
const putReject = (await import("./[id]/payment/reject/route")).PUT as RouteHandler;

let orderId: string;

beforeAll(async () => {
  await connectToDatabase();
});
afterAll(async () => {
  await Promise.all([OrderModel.deleteMany({}), PaymentProofModel.deleteMany({}), removeHarnessStaff()]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  mintCount = 0;
  await Promise.all([OrderModel.deleteMany({}), PaymentProofModel.deleteMany({}), removeHarnessStaff()]);
  const order = await OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    status: "PLACED",
    placedAt: new Date(),
    subtotal: new Decimal("10.00"),
    total: new Decimal("10.00"),
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    payment: { method: "WALLET_TRANSFER", status: "SUBMITTED" },
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
  });
  orderId = order._id.toString();
  await PaymentProofModel.create({ orderId: order._id, submittedAt: new Date(), asset: { publicId: "payment-proofs/a", format: "jpg", bytes: 100, mimeType: "image/jpeg", filename: "receipt.jpg" }, status: "SUBMITTED" });
});

const detail = (caller: Awaited<ReturnType<typeof signInAsOwner>>) => caller.call(getDetail, `/api/admin/orders/${orderId}`, { params: { id: orderId } });
const decide = (caller: Awaited<ReturnType<typeof signInAsOwner>>, handler: RouteHandler, verb: "verify" | "reject", body: unknown) =>
  caller.call(handler, `/api/admin/orders/${orderId}/payment/${verb}`, { method: "PUT", body, params: { id: orderId } });

describe("payment proof on the admin order detail", () => {
  it("a Payment.verify holder gets the proof metadata and a freshly minted signed link", async () => {
    const verifier = await signInWithPermissions([AppPermission.ORDER.READ_ONE, CustomPermission.PAYMENT_VERIFY]);

    const response = await detail(verifier);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.paymentProofs).toHaveLength(1);
    expect(body.paymentProofs[0]).toMatchObject({ status: "SUBMITTED", filename: "receipt.jpg", mimeType: "image/jpeg" });
    expect(body.paymentProofs[0].signedUrl).toMatch(/^https:\/\/signed\.example\/payment-proofs\/a\?n=1&ttl=300$/);
  });

  it("mints a NEW link on every request — nothing stored is ever returned", async () => {
    const verifier = await signInWithPermissions([AppPermission.ORDER.READ_ONE, CustomPermission.PAYMENT_VERIFY]);

    const first = (await (await detail(verifier)).json()).paymentProofs[0].signedUrl;
    const second = (await (await detail(verifier)).json()).paymentProofs[0].signedUrl;

    expect(second).not.toBe(first);
    expect(JSON.stringify(await PaymentProofModel.findOne({ orderId }).lean())).not.toContain("signed.example");
  });

  it("NEGATIVE: order-read alone gets the order but no proof and no link", async () => {
    const reader = await signInWithPermissions([AppPermission.ORDER.READ_ONE]);

    const response = await detail(reader);
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(text).not.toContain("signed.example");
    expect(text).not.toContain("receipt.jpg");
    expect(text).not.toContain("paymentProofs\":[");
    expect(mintCount).toBe(0);
  });

  it.each([
    ["the default Fulfilment role", [AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE, CustomPermission.ORDER_TRANSITION]],
    ["the default Support role (incl. refunds)", [AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE, CustomPermission.PAYMENT_REFUND]],
    ["reject-only", [AppPermission.ORDER.READ_ONE, CustomPermission.PAYMENT_REJECT]],
  ])("NEGATIVE: %s gets no proof and no link", async (_label, keys) => {
    const staff = await signInWithPermissions(keys);

    const text = JSON.stringify(await (await detail(staff)).json());

    expect(text).not.toContain("signed.example");
    expect(text).not.toContain("receipt.jpg");
    expect(mintCount).toBe(0);
  });

  it("NEGATIVE: Payment.verify alone, without order-read, still cannot read the order at all (403)", async () => {
    const verifierOnly = await signInWithPermissions([CustomPermission.PAYMENT_VERIFY]);
    expect((await detail(verifierOnly)).status).toBe(403);
  });

  it("the Owner (full access) sees the proof", async () => {
    const owner = await signInAsOwner();
    expect((await (await detail(owner)).json()).paymentProofs[0].signedUrl).toContain("signed.example");
  });

  it("stays viewable after the payment is VERIFIED, with who verified it", async () => {
    const owner = await signInAsOwner();
    expect((await decide(owner, putVerify, "verify", {})).status).toBe(200);

    const body = await (await detail(owner)).json();

    expect(body.payment.status).toBe("VERIFIED");
    expect(body.paymentProofs[0]).toMatchObject({ status: "VERIFIED", reviewedByName: "Owner" });
    expect(body.paymentProofs[0].signedUrl).toContain("signed.example");
  });

  it("stays viewable after REJECTION, with the reason, alongside a later resubmission (newest first)", async () => {
    const owner = await signInAsOwner();
    expect((await decide(owner, putReject, "reject", { reason: "Blurry" })).status).toBe(200);
    await PaymentProofModel.create({ orderId, submittedAt: new Date(Date.now() + 1000), asset: { publicId: "payment-proofs/b", format: "png", bytes: 100, mimeType: "image/png", filename: "again.png" }, status: "SUBMITTED" });

    const body = await (await detail(owner)).json();

    expect(body.paymentProofs.map((proof: { filename: string }) => proof.filename)).toEqual(["again.png", "receipt.jpg"]);
    expect(body.paymentProofs[1]).toMatchObject({ status: "REJECTED", rejectionReason: "Blurry", reviewedByName: "Owner" });
    expect(body.paymentProofs[1].signedUrl).toContain("payment-proofs/a");
  });

  it("an order with no proof (e.g. cash on delivery) gets an empty list, not an error", async () => {
    await PaymentProofModel.deleteMany({});
    const owner = await signInAsOwner();

    const response = await detail(owner);

    expect(response.status).toBe(200);
    expect((await response.json()).paymentProofs).toEqual([]);
  });
});

describe("the timeline names the staff member who acted", () => {
  it("resolves the verifier's name from actorId — to a reader who cannot see proofs too", async () => {
    const owner = await signInAsOwner();
    await decide(owner, putVerify, "verify", {});
    const reader = await signInWithPermissions([AppPermission.ORDER.READ_ONE]);

    const body = await (await detail(reader)).json();

    const verified = body.timeline.find((entry: { type: string }) => entry.type === "PAYMENT_VERIFIED");
    expect(verified).toMatchObject({ actorType: "STAFF", actorName: "Owner" });
    expect(verified.actorId).toMatch(/^[0-9a-f]{24}$/);
    const placed = body.timeline.find((entry: { type: string }) => entry.type === "ORDER_PLACED");
    expect(placed.actorName).toBeUndefined();
  });

  it("a staff account that no longer exists leaves the entry with its id and no name", async () => {
    const owner = await signInAsOwner();
    await decide(owner, putVerify, "verify", {});
    await removeHarnessStaff();
    const reader = await signInWithPermissions([AppPermission.ORDER.READ_ONE]);

    const verified = (await (await detail(reader)).json()).timeline.find((entry: { type: string }) => entry.type === "PAYMENT_VERIFIED");

    expect(verified.actorType).toBe("STAFF");
    expect(verified.actorId).toBeDefined();
    expect(verified.actorName).toBeUndefined();
  });
});
