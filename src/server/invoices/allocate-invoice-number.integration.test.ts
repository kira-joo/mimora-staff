// @vitest-environment node
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { OrderSequenceModel } from "../commerce/order-sequence.schema";
import { InvoiceSequenceModel } from "./invoice-sequence.schema";
import { allocateInvoiceNumber, formatInvoiceNumber } from "./allocate-invoice-number";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(connectToDatabase);
afterEach(() => Promise.all([InvoiceSequenceModel.deleteMany({}), OrderSequenceModel.deleteMany({})]));
afterAll(() => mongoose.disconnect());

describe("formatInvoiceNumber", () => {
  it("zero-pads to six digits and never truncates", () => {
    expect(formatInvoiceNumber(1)).toBe("INV-000001");
    expect(formatInvoiceNumber(1234567)).toBe("INV-1234567");
  });
});

describe("allocateInvoiceNumber", () => {
  it("starts at 1 and increments, on its own counter", async () => {
    await OrderSequenceModel.create({ key: "order", value: 99 });
    await withTransaction(async (tx) => {
      expect(await allocateInvoiceNumber()).toBe("INV-000001");
      expect(await allocateInvoiceNumber()).toBe("INV-000002");
      return tx.complete(undefined);
    });
    expect((await OrderSequenceModel.findOne({ key: "order" }).lean())?.value).toBe(99);
  });

  it("never hands the same number to concurrent callers", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, () => withTransaction(async (tx) => tx.complete(await allocateInvoiceNumber()))));
    const numbers = outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
    expect(numbers.length).toBeGreaterThan(0);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("returns the number when its transaction rolls back, leaving no gap", async () => {
    await expect(
      withTransaction(async () => {
        await allocateInvoiceNumber();
        throw new Error("placement failed after allocating");
      })
    ).rejects.toThrow(/placement failed/);

    const next = await withTransaction(async (tx) => tx.complete(await allocateInvoiceNumber()));
    expect(next).toBe("INV-000001");
  });
});
