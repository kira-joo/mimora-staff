import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { AddressModel } from "../../core/address.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { createAddress } from "./create-address";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("createAddress", () => {
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

  it("creates an address with all fields", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000001",
      passwordHash: "hash",
      name: "Customer",
    });

    const result = await createAddress(customer._id.toString(), {
      label: "Home",
      recipientName: "John Doe",
      phone: "+201000000001",
      addressLine1: "123 Main St",
      addressLine2: "Apt 4B",
      city: "Cairo",
      governorate: "Cairo",
      postalCode: "11511",
      isDefault: false,
    });

    expect(result.label).toBe("Home");
    expect(result.recipientName).toBe("John Doe");
    expect(result.addressLine1).toBe("123 Main St");
    expect(result.addressLine2).toBe("Apt 4B");
    expect(result.postalCode).toBe("11511");
    expect(result.isDefault).toBe(true); // First address is always default

    const dbAddress = await AddressModel.findById(result._id);
    expect(dbAddress?.isDefault).toBe(true);
  });

  it("sets first address as default regardless of input", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000002",
      passwordHash: "hash",
      name: "Customer",
    });

    const result = await createAddress(customer._id.toString(), {
      label: "Work",
      recipientName: "Jane Doe",
      phone: "+201000000002",
      addressLine1: "456 Office Rd",
      city: "Alexandria",
      governorate: "Alexandria",
      isDefault: false,
    });

    expect(result.isDefault).toBe(true);
  });

  it("respects isDefault: false for subsequent addresses", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000003",
      passwordHash: "hash",
      name: "Customer",
    });

    await createAddress(customer._id.toString(), {
      label: "First",
      recipientName: "Name",
      phone: "+201000000003",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
    });

    const result = await createAddress(customer._id.toString(), {
      label: "Second",
      recipientName: "Name",
      phone: "+201000000003",
      addressLine1: "456",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: false,
    });

    expect(result.isDefault).toBe(false);
  });

  it("sets new address as default and clears old default when isDefault: true", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000004",
      passwordHash: "hash",
      name: "Customer",
    });

    const first = await createAddress(customer._id.toString(), {
      label: "First",
      recipientName: "Name",
      phone: "+201000000004",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
    });

    expect(first.isDefault).toBe(true);

    const second = await createAddress(customer._id.toString(), {
      label: "Second",
      recipientName: "Name",
      phone: "+201000000004",
      addressLine1: "456",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: true,
    });

    expect(second.isDefault).toBe(true);

    const firstUpdated = await AddressModel.findById(first._id);
    expect(firstUpdated?.isDefault).toBe(false);
  });

  it("maintains only one default address per customer", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000005",
      passwordHash: "hash",
      name: "Customer",
    });

    await createAddress(customer._id.toString(), {
      label: "First",
      recipientName: "Name",
      phone: "+201000000005",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
    });

    await createAddress(customer._id.toString(), {
      label: "Second",
      recipientName: "Name",
      phone: "+201000000005",
      addressLine1: "456",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: true,
    });

    const defaultCount = await AddressModel.countDocuments({
      customerId: customer._id,
      isDefault: true,
    });

    expect(defaultCount).toBe(1);
  });

  it("handles optional fields correctly", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000006",
      passwordHash: "hash",
      name: "Customer",
    });

    const result = await createAddress(customer._id.toString(), {
      label: "Minimal",
      recipientName: "Name",
      phone: "+201000000006",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
    });

    expect(result.addressLine2).toBeUndefined();
    expect(result.postalCode).toBeUndefined();
  });
});
