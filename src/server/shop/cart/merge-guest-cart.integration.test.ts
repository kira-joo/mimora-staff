// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CartModel } from "../../commerce/cart.schema";
import { CartLineModel, buildCartLineIdentityKey } from "../../commerce/cart-line.schema";
import { cartRepository } from "../../core/repositories";
import { mergeGuestCart, mergeGuestCartOnSignIn } from "./merge-guest-cart";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([CartModel.deleteMany({}), CartLineModel.deleteMany({})]);
});
afterAll(async () => {
  await mongoose.disconnect();
});

const oid = () => new mongoose.Types.ObjectId();
const TOKEN = "guest-token-merge";

async function addLine(cartId: mongoose.Types.ObjectId, variantId: mongoose.Types.ObjectId, quantity: number, note?: string) {
  return CartLineModel.create({ cartId, variantId, quantity, note, lineIdentityKey: buildCartLineIdentityKey(cartId, variantId, note) });
}
const linesOf = async (cartId: mongoose.Types.ObjectId) => (await CartLineModel.find({ cartId }).lean()).map((l) => ({ v: l.variantId.toString(), q: l.quantity, n: l.note }));
const draft = (mode: "PICKUP" | "DELIVERY" = "PICKUP") => ({ mode, pickupLocationId: oid() });

describe("mergeGuestCart", () => {
  it("customer has no cart: the guest cart is re-keyed to the customer, token unset, lines intact", async () => {
    const customerId = oid();
    const variant = oid();
    const guest = await CartModel.create({ cartToken: TOKEN, appliedPromotionCode: "SAVE", fulfilmentDraft: draft() });
    await addLine(guest._id, variant, 2);

    const result = await mergeGuestCart(customerId.toString(), TOKEN);

    expect(result).toEqual({ merged: true, lineCount: 1 });
    const cart = await CartModel.findById(guest._id).lean();
    expect(cart?.customerId?.toString()).toBe(customerId.toString());
    expect(cart?.cartToken).toBeUndefined();
    expect(cart?.appliedPromotionCode).toBe("SAVE");
    expect(await linesOf(guest._id)).toEqual([{ v: variant.toString(), q: 2, n: undefined }]);
    expect(await CartModel.countDocuments({})).toBe(1);
  });

  it("both carts: same (variant, note) adds quantities, others move, guest cart deleted, customer's draft and promo win", async () => {
    const customerId = oid();
    const [shared, onlyGuest, onlyCustomer, noted] = [oid(), oid(), oid(), oid()];
    const customerDraft = draft("DELIVERY");
    const customerCart = await CartModel.create({ customerId, appliedPromotionCode: "MINE", fulfilmentDraft: { mode: "DELIVERY", address: { recipientName: "R", phone: "1", addressLine1: "a", city: "c", governorate: "g" } } });
    await addLine(customerCart._id, shared, 1);
    await addLine(customerCart._id, onlyCustomer, 4);
    await addLine(customerCart._id, noted, 1, "gift");
    const guestCart = await CartModel.create({ cartToken: TOKEN, appliedPromotionCode: "THEIRS", fulfilmentDraft: customerDraft });
    await addLine(guestCart._id, shared, 2);
    await addLine(guestCart._id, onlyGuest, 3);
    await addLine(guestCart._id, noted, 5); // same variant, DIFFERENT note: a separate line
    await addLine(guestCart._id, noted, 7, "gift"); // same variant and note: combines

    const result = await mergeGuestCart(customerId.toString(), TOKEN);

    expect(result).toEqual({ merged: true, lineCount: 4 });
    expect(await CartModel.findById(guestCart._id)).toBeNull();
    expect(await CartLineModel.countDocuments({ cartId: guestCart._id })).toBe(0);
    const merged = await linesOf(customerCart._id);
    const byKey = (v: mongoose.Types.ObjectId, n?: string) => merged.find((l) => l.v === v.toString() && l.n === n)?.q;
    expect(byKey(shared)).toBe(3);
    expect(byKey(onlyCustomer)).toBe(4);
    expect(byKey(onlyGuest)).toBe(3);
    expect(byKey(noted)).toBe(5);
    expect(byKey(noted, "gift")).toBe(8);
    expect(merged).toHaveLength(5);
    const cart = await CartModel.findById(customerCart._id).lean();
    expect(cart?.appliedPromotionCode).toBe("MINE");
    expect(cart?.fulfilmentDraft?.mode).toBe("DELIVERY");
  });

  it("both carts: the guest's draft and promotion are adopted only where the customer has none", async () => {
    const customerId = oid();
    const customerCart = await CartModel.create({ customerId });
    const guestDraft = draft();
    await CartModel.create({ cartToken: TOKEN, appliedPromotionCode: "GUESTPROMO", fulfilmentDraft: guestDraft });

    await mergeGuestCart(customerId.toString(), TOKEN);

    const cart = await CartModel.findById(customerCart._id).lean();
    expect(cart?.appliedPromotionCode).toBe("GUESTPROMO");
    expect(cart?.fulfilmentDraft?.mode).toBe("PICKUP");
  });

  it("no token, unknown token, or an already-merged token is a quiet no-op", async () => {
    const customerId = oid().toString();
    expect(await mergeGuestCart(customerId, null)).toEqual({ merged: false, lineCount: 0 });
    expect(await mergeGuestCart(customerId, "nope")).toEqual({ merged: false, lineCount: 0 });
  });

  it("ROLLBACK: a failure mid-merge leaves no collection with partial state (guest cart + lines intact, customer quantities unchanged)", async () => {
    const customerId = oid();
    const [shared, onlyGuest] = [oid(), oid()];
    const customerCart = await CartModel.create({ customerId });
    await addLine(customerCart._id, shared, 1);
    const guestCart = await CartModel.create({ cartToken: TOKEN, appliedPromotionCode: "GP" });
    await addLine(guestCart._id, shared, 2);
    await addLine(guestCart._id, onlyGuest, 3);

    // Fail at the very last step, after the quantities were added, a line moved and the promotion adopted.
    vi.spyOn(cartRepository, "delete").mockRejectedValue(new Error("boom"));

    await expect(mergeGuestCart(customerId.toString(), TOKEN)).rejects.toThrow("boom");

    expect(await CartModel.findById(guestCart._id)).not.toBeNull();
    expect((await CartModel.findById(guestCart._id).lean())?.cartToken).toBe(TOKEN);
    expect((await linesOf(guestCart._id)).map((l) => l.q).sort()).toEqual([2, 3]);
    expect(await linesOf(customerCart._id)).toEqual([{ v: shared.toString(), q: 1, n: undefined }]);
    expect((await CartModel.findById(customerCart._id).lean())?.appliedPromotionCode).toBeUndefined();
  });

  it("the sign-in wrapper swallows a merge failure, logs it, and reports not merged", async () => {
    const customerId = oid();
    const guestCart = await CartModel.create({ cartToken: TOKEN });
    await addLine(guestCart._id, oid(), 1);
    await CartModel.create({ customerId });
    vi.spyOn(cartRepository, "delete").mockRejectedValue(new Error("boom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await mergeGuestCartOnSignIn(customerId.toString(), TOKEN)).toEqual({ merged: false, lineCount: 0 });
    expect(log).toHaveBeenCalled();
    expect(await CartModel.findById(guestCart._id)).not.toBeNull();
  });
});
