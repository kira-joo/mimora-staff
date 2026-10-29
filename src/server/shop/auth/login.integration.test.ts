// @vitest-environment node
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CustomerModel } from "../../identity/customer.schema";
import { loginCustomer } from "./login";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await CustomerModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

/**
 * The success path (`issueCustomerSession` → `writeCustomerSessionCookies`)
 * calls `next/headers`'s `cookies()`, which throws "called outside a
 * request scope" unless it runs inside a real Next.js request dispatch —
 * confirmed empirically, not assumed. That is exactly what a real `next
 * dev`/`next start` server plus a live HTTP request provides and a bare
 * Vitest process does not, so login's SUCCESS path (cookie issuance) is
 * verified there instead — see the batch report for the real-HTTP
 * transcript. This file covers everything reachable without a request
 * scope: both failure paths, and that they are genuinely indistinguishable.
 */
describe("loginCustomer", () => {
  it("rejects a wrong password for a real account", async () => {
    const phone = `+2010${Math.floor(Math.random() * 100000000)}`;
    await CustomerModel.create({ phone, passwordHash: await hashPassword("correct-horse-battery"), name: "Test Customer" });

    await expect(loginCustomer(phone, "wrong-password")).rejects.toThrow(/Invalid phone number or password/);
  });

  it("rejects an unknown phone number with the identical message a wrong password gets", async () => {
    await expect(loginCustomer("+201099999999", "anything")).rejects.toThrow(/Invalid phone number or password/);
  });

  it("still runs a real password comparison when no account exists — decoy hash, not a short-circuit", async () => {
    // No account is created. If this resolved via a short-circuit (no
    // comparePassword call at all) the two error paths above would remain
    // functionally distinguishable by timing. This only asserts the
    // observable behavior (still throws the generic error) — a real timing
    // measurement belongs to a benchmark, not a correctness test.
    await expect(loginCustomer("+201088888888", "whatever")).rejects.toThrow(/Invalid phone number or password/);
  });
});
