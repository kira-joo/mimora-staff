import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { AddressModel } from "../../core/address.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { listAddresses } from "./list-addresses";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("listAddresses", () => {
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

  it("returns only the customer's addresses", async () => {
    const customer1 = await CustomerModel.create({
      phone: "+201000000001",
      passwordHash: "hash",
      name: "Customer 1",
    });

    const customer2 = await CustomerModel.create({
      phone: "+201000000002",
      passwordHash: "hash",
      name: "Customer 2",
    });

    await AddressModel.create({
      customerId: customer1._id,
      label: "Home",
      recipientName: "Customer 1",
      phone: "+201000000001",
      addressLine1: "123 Street",
      city: "Cairo",
      governorate: "Cairo",
    });

    await AddressModel.create({
      customerId: customer2._id,
      label: "Home",
      recipientName: "Customer 2",
      phone: "+201000000002",
      addressLine1: "456 Street",
      city: "Alexandria",
      governorate: "Alexandria",
    });

    const result = await listAddresses(customer1._id.toString(), { limit: 50, skip: 0 });

    expect(result.total).toBe(1);
    expect(result.addresses).toHaveLength(1);
    expect(result.addresses[0].recipientName).toBe("Customer 1");
  });

  it("sorts with default first, then by creation date descending", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000003",
      passwordHash: "hash",
      name: "Customer",
    });

    const addr1 = await AddressModel.create({
      customerId: customer._id,
      label: "First",
      recipientName: "Name",
      phone: "+201000000003",
      addressLine1: "123",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const addr2 = await AddressModel.create({
      customerId: customer._id,
      label: "Second Default",
      recipientName: "Name",
      phone: "+201000000003",
      addressLine1: "456",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const addr3 = await AddressModel.create({
      customerId: customer._id,
      label: "Third",
      recipientName: "Name",
      phone: "+201000000003",
      addressLine1: "789",
      city: "Cairo",
      governorate: "Cairo",
      isDefault: false,
    });

    const result = await listAddresses(customer._id.toString(), { limit: 50, skip: 0 });

    expect(result.addresses).toHaveLength(3);
    expect(result.addresses[0].label).toBe("Second Default");
    expect(result.addresses[1].label).toBe("Third");
    expect(result.addresses[2].label).toBe("First");
  });

  it("supports pagination", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000004",
      passwordHash: "hash",
      name: "Customer",
    });

    for (let i = 0; i < 5; i++) {
      await AddressModel.create({
        customerId: customer._id,
        label: `Address ${i}`,
        recipientName: "Name",
        phone: "+201000000004",
        addressLine1: "123",
        city: "Cairo",
        governorate: "Cairo",
      });
    }

    const page1 = await listAddresses(customer._id.toString(), { limit: 2, skip: 0 });
    expect(page1.addresses).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page2 = await listAddresses(customer._id.toString(), { limit: 2, skip: 2 });
    expect(page2.addresses).toHaveLength(2);
    expect(page2.total).toBe(5);

    const page3 = await listAddresses(customer._id.toString(), { limit: 2, skip: 4 });
    expect(page3.addresses).toHaveLength(1);
    expect(page3.total).toBe(5);
  });

  it("returns empty array when customer has no addresses", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000005",
      passwordHash: "hash",
      name: "Customer",
    });

    const result = await listAddresses(customer._id.toString(), { limit: 50, skip: 0 });

    expect(result.addresses).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});
