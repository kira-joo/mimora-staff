import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { connectToDatabase } from "../../core/db/connect";
import { AddressModel } from "../../core/address.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { updateAddress } from "./update-address";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("updateAddress", () => {
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

  it("updates address fields", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000001",
      passwordHash: "hash",
      name: "Customer",
    });

    const address = await AddressModel.create({
      customerId: customer._id,
      label: "Home",
      recipientName: "Old Name",
      phone: "+201000000001",
      addressLine1: "123 Old St",
      city: "Cairo",
      governorate: "Cairo",
    });

    const result = await updateAddress(customer._id.toString(), address._id.toString(), {
      label: "Work",
      recipientName: "New Name",
      addressLine1: "456 New St",
    });

    expect(result.label).toBe("Work");
    expect(result.recipientName).toBe("New Name");
    expect(result.addressLine1).toBe("456 New St");
    expect(result.city).toBe("Cairo"); // Unchanged
  });

  it("sets address as default and clears old default", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000002",
      passwordHash: "hash",
      name: "Customer",
    });

    const address1 = await AddressModel.create({
      customerId: customer._id,
      label: "First",
      recipientName: "Name",
      phone: "+201000000002",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: true,
    });

    const address2 = await AddressModel.create({
      customerId: customer._id,
      label: "Second",
      recipientName: "Name",
      phone: "+201000000002",
      addressLine1: "456",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: false,
    });

    const result = await updateAddress(customer._id.toString(), address2._id.toString(), {
      isDefault: true,
    });

    expect(result.isDefault).toBe(true);

    const oldDefault = await AddressModel.findById(address1._id);
    expect(oldDefault?.isDefault).toBe(false);
  });

  it("does not clear default when updating the same default address", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000003",
      passwordHash: "hash",
      name: "Customer",
    });

    const address = await AddressModel.create({
      customerId: customer._id,
      label: "Home",
      recipientName: "Name",
      phone: "+201000000003",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: true,
    });

    const result = await updateAddress(customer._id.toString(), address._id.toString(), {
      label: "Updated Home",
      isDefault: true,
    });

    expect(result.isDefault).toBe(true);
    expect(result.label).toBe("Updated Home");
  });

  it("maintains only one default address per customer", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000004",
      passwordHash: "hash",
      name: "Customer",
    });

    await AddressModel.create({
      customerId: customer._id,
      label: "First",
      recipientName: "Name",
      phone: "+201000000004",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: true,
    });

    const address2 = await AddressModel.create({
      customerId: customer._id,
      label: "Second",
      recipientName: "Name",
      phone: "+201000000004",
      addressLine1: "456",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: false,
    });

    await updateAddress(customer._id.toString(), address2._id.toString(), {
      isDefault: true,
    });

    const defaultCount = await AddressModel.countDocuments({
      customerId: customer._id,
      isDefault: true,
    });

    expect(defaultCount).toBe(1);
  });

  it("throws NotFoundError when address does not exist", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000005",
      passwordHash: "hash",
      name: "Customer",
    });

    const nonExistentId = new mongoose.Types.ObjectId();

    await expect(
      updateAddress(customer._id.toString(), nonExistentId.toString(), {
        label: "Updated",
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when address belongs to another customer", async () => {
    const customer1 = await CustomerModel.create({
      phone: "+201000000006",
      passwordHash: "hash",
      name: "Customer 1",
    });

    const customer2 = await CustomerModel.create({
      phone: "+201000000007",
      passwordHash: "hash",
      name: "Customer 2",
    });

    const address = await AddressModel.create({
      customerId: customer1._id,
      label: "Home",
      recipientName: "Customer 1",
      phone: "+201000000006",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
    });

    await expect(
      updateAddress(customer2._id.toString(), address._id.toString(), {
        label: "Updated",
      })
    ).rejects.toThrow(NotFoundError);
  });
});
