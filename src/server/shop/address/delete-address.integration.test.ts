import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { connectToDatabase } from "../../core/db/connect";
import { AddressModel } from "../../core/address.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { deleteAddress } from "./delete-address";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("deleteAddress", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await AddressModel.deleteMany({});
    await CustomerModel.deleteMany({});
  });

  it("deletes the address when it belongs to the customer", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000001",
      passwordHash: "hash",
      name: "Customer",
    });

    const address = await AddressModel.create({
      customerId: customer._id,
      label: "Home",
      recipientName: "Name",
      phone: "+201000000001",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
    });

    await deleteAddress(customer._id.toString(), address._id.toString());

    const deleted = await AddressModel.findById(address._id);
    expect(deleted).toBeNull();
  });

  it("throws NotFoundError when address does not exist", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000002",
      passwordHash: "hash",
      name: "Customer",
    });

    const nonExistentId = new mongoose.Types.ObjectId();

    await expect(deleteAddress(customer._id.toString(), nonExistentId.toString())).rejects.toThrow(NotFoundError);
    await expect(deleteAddress(customer._id.toString(), nonExistentId.toString())).rejects.toThrow("Address not found");
  });

  it("throws NotFoundError when address belongs to another customer", async () => {
    const customer1 = await CustomerModel.create({
      phone: "+201000000003",
      passwordHash: "hash",
      name: "Customer 1",
    });

    const customer2 = await CustomerModel.create({
      phone: "+201000000004",
      passwordHash: "hash",
      name: "Customer 2",
    });

    const address = await AddressModel.create({
      customerId: customer1._id,
      label: "Home",
      recipientName: "Customer 1",
      phone: "+201000000003",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
    });

    await expect(deleteAddress(customer2._id.toString(), address._id.toString())).rejects.toThrow(NotFoundError);

    // Verify address still exists
    const stillExists = await AddressModel.findById(address._id);
    expect(stillExists).not.toBeNull();
  });

  it("is idempotent - second delete throws NotFoundError", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000005",
      passwordHash: "hash",
      name: "Customer",
    });

    const address = await AddressModel.create({
      customerId: customer._id,
      label: "Home",
      recipientName: "Name",
      phone: "+201000000005",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
    });

    await deleteAddress(customer._id.toString(), address._id.toString());
    await expect(deleteAddress(customer._id.toString(), address._id.toString())).rejects.toThrow(NotFoundError);
  });
});
