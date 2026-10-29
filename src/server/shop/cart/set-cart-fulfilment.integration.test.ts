// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CartModel } from "../../commerce/cart.schema";
import { PickupLocationModel } from "../../fulfilment/pickup-location.schema";
import { getCart } from "../get-cart";
import type { ShopActor } from "../shop-actor";
import { setCartFulfilment } from "./set-cart-fulfilment";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await CartModel.deleteMany({});
  await PickupLocationModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

function actorFor(customerId: mongoose.Types.ObjectId): ShopActor {
  return { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };
}

const address = {
  recipientName: "Jane Doe",
  phone: "+201000000000",
  addressLine1: "1 Test St",
  city: "Cairo",
  governorate: "Cairo",
};

describe("setCartFulfilment", () => {
  it("stores a DELIVERY draft with an inline address — no fee/zone/dispatch fields stored", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });

    const view = await setCartFulfilment(actorFor(customerId), { mode: "DELIVERY", address });

    expect(view.fulfilmentDraft?.mode).toBe("DELIVERY");
    expect(view.fulfilmentDraft?.address?.recipientName).toBe("Jane Doe");
    expect(view.fulfilmentDraft).not.toHaveProperty("fee");
    expect(view.fulfilmentDraft).not.toHaveProperty("dispatchBy");
  });

  it("stores a PICKUP draft when the pickup location is real and active", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });
    const location = await PickupLocationModel.create({
      name: { en: "Main", ar: "الرئيسي" },
      address: { en: "1 St", ar: "شارع 1" },
      phone: "+201000000000",
    });

    const view = await setCartFulfilment(actorFor(customerId), { mode: "PICKUP", pickupLocationId: location._id.toString() });

    expect(view.fulfilmentDraft?.mode).toBe("PICKUP");
    expect(view.fulfilmentDraft?.pickupLocationId?.toString()).toBe(location._id.toString());
  });

  it("rejects an unknown pickupLocationId", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });

    await expect(
      setCartFulfilment(actorFor(customerId), { mode: "PICKUP", pickupLocationId: new mongoose.Types.ObjectId().toString() })
    ).rejects.toThrow(/No such pickup location/);
  });

  it("rejects when no cart exists yet", async () => {
    await expect(setCartFulfilment(actorFor(new mongoose.Types.ObjectId()), { mode: "DELIVERY", address })).rejects.toThrow(
      /No cart exists/
    );
  });

  it("round-trips through GET /cart afterward", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });

    await setCartFulfilment(actorFor(customerId), { mode: "DELIVERY", address });
    const view = await getCart(actorFor(customerId));

    expect(view.fulfilmentDraft?.mode).toBe("DELIVERY");
    expect(view.fulfilmentDraft?.address?.city).toBe("Cairo");
  });
});
