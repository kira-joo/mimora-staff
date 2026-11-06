import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CustomerModel } from "../../identity/customer.schema";
import { AddressModel } from "../../core/address.schema";
import { listCustomers } from "./list-customers";
import { getCustomerDetailAdmin } from "./get-customer-detail";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

async function seedCustomer(overrides: Partial<{ name: string; phone: string; email: string }> = {}) {
  return CustomerModel.create({
    name: overrides.name ?? "Test Customer",
    phone: overrides.phone ?? `+2010${Math.floor(Math.random() * 100000000)}`,
    email: overrides.email,
    passwordHash: "hashed",
  });
}

describe("Admin Customers", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([CustomerModel.deleteMany({}), AddressModel.deleteMany({})]);
  });

  describe("listCustomers", () => {
    it("lists customers with pagination", async () => {
      await seedCustomer({ name: "Alice" });
      await seedCustomer({ name: "Bob" });

      const result = await listCustomers({ limit: 10, page: 1 });
      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    it("searches by name, phone or email", async () => {
      await seedCustomer({ name: "Alice Wonderland", phone: "+201111111111" });
      await seedCustomer({ name: "Bob Builder", phone: "+201222222222" });

      const result = await listCustomers({ limit: 10, page: 1, search: "wonderland" });
      expect(result.total).toBe(1);
      expect(result.data[0]?.name).toBe("Alice Wonderland");
    });

    it("never exposes passwordHash", async () => {
      await seedCustomer();
      const result = await listCustomers({ limit: 10, page: 1 });
      expect((result.data[0] as { passwordHash?: unknown }).passwordHash).toBeUndefined();
    });
  });

  describe("getCustomerDetailAdmin", () => {
    it("returns the customer with their addresses", async () => {
      const customer = await seedCustomer({ name: "Alice" });
      await AddressModel.create({
        customerId: customer._id,
        label: "Home",
        recipientName: "Alice",
        phone: customer.phone,
        addressLine1: "123 Main St",
        city: "Cairo",
        governorate: "Cairo",
      });

      const detail = await getCustomerDetailAdmin(customer._id.toString());
      expect(detail.customer.name).toBe("Alice");
      expect(detail.addresses).toHaveLength(1);
      expect((detail.customer as { passwordHash?: unknown }).passwordHash).toBeUndefined();
    });
  });
});
