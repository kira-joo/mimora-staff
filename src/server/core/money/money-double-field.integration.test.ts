import { sanitizeLeanResult } from "@kira-joo/backend-toolkit-mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../db/connect";
import { ALL_MODELS } from "../db/model-registry";
import { deliveryZoneRepository } from "../repositories";
import { DeliveryZoneModel } from "../../fulfilment/delivery-zone.schema";
import { MONEY_PATH_MARKER, moneyPaths, normalizeMoneyPaths, toLegacyMoneyValue } from "./money-double-field";

/**
 * Money at rest is BSON Double; records written before the change hold Decimal128 until the data migration runs, and
 * a record re-saved before then keeps Decimal128 on every field it did not touch. Every read path must give the
 * application exactly what it got before — a `Decimal` to calculate with, a decimal string on the wire — from either.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const zone = (fields: Record<string, unknown> = {}) => ({ name: { en: "Maadi", ar: "المعادي" }, areas: ["Maadi"], fee: toMoney("30"), leadDays: 1, ...fields });
const d128 = (value: string) => mongoose.Types.Decimal128.fromString(value);

async function storedTypes(id: mongoose.Types.ObjectId) {
  const [row] = await DeliveryZoneModel.collection.aggregate([{ $match: { _id: id } }, { $project: { _id: 0, fee: { $type: "$fee" }, minimumOrder: { $type: "$minimumOrder" } } }]).toArray();
  return row;
}

/** A record exactly as written before the storage change. */
async function insertLegacyZone(fee: string, minimumOrder?: string) {
  const { insertedId } = await DeliveryZoneModel.collection.insertOne({ ...zone(), fee: d128(fee), ...(minimumOrder ? { minimumOrder: d128(minimumOrder) } : {}), createdAt: new Date(), updatedAt: new Date() });
  return insertedId;
}

beforeAll(async () => {
  await connectToDatabase();
});
afterAll(async () => {
  await mongoose.disconnect();
});
beforeEach(async () => {
  await DeliveryZoneModel.deleteMany({});
});

describe("writes are BSON Double — never Int32, never Decimal128, never a string", () => {
  it.each([
    ["a whole amount (the Int32 trap)", toMoney("30"), 30],
    ["zero", toMoney("0"), 0],
    ["a DTO string", "560.5", 560.5],
    ["an unrounded Decimal (rounded half-up once)", toMoney("12.345"), 12.35],
    ["half a cent", toMoney("0.005"), 0.01],
    ["a Decimal128 handed back in", d128("19.99"), 19.99],
  ])("%s", async (_label, fee, stored) => {
    const created = await DeliveryZoneModel.create(zone({ fee, minimumOrder: fee }));
    expect(await storedTypes(created._id)).toEqual({ fee: "double", minimumOrder: "double" });
    expect((await DeliveryZoneModel.collection.findOne({ _id: created._id }))?.fee).toBe(stored);
  });

  it("an update through the repository ($set) stores a double too", async () => {
    const created = await DeliveryZoneModel.create(zone());
    await deliveryZoneRepository.updateAtomic({ _id: created._id }, { $set: { fee: toMoney("45"), minimumOrder: toMoney("0") } });
    expect(await storedTypes(created._id)).toEqual({ fee: "double", minimumOrder: "double" });
  });

  it("stores the largest exact amount, and refuses one a double could not hold to the cent — never storing it approximately", async () => {
    const largest = await DeliveryZoneModel.create(zone({ fee: "9999999999999.99" }));
    expect((await DeliveryZoneModel.collection.findOne({ _id: largest._id }))?.fee).toBe(9999999999999.99);
    // 1000000000000000.01 as a double is 1000000000000000 — a lost cent. Refused, as a non-finite value always was:
    // Mongoose reports the setter's refusal as a validation error on the field, whose cause is the MoneyError.
    const refusal = async (fee: string) => {
      const error = (await DeliveryZoneModel.create(zone({ fee })).catch((caught: unknown) => caught)) as { name?: string; errors?: Record<string, { reason?: Error }> };
      return { name: error.name, cause: error.errors?.fee?.reason?.message };
    };
    expect(await refusal("1000000000000000.01")).toEqual({ name: "ValidationError", cause: expect.stringMatching(/too large to store exactly/) });
    expect(await refusal("10000000000000.00")).toEqual({ name: "ValidationError", cause: expect.stringMatching(/too large to store exactly/) });
    expect(await DeliveryZoneModel.countDocuments()).toBe(1);
  });

  it("refuses a value that is not a finite amount, as before", async () => {
    await expect(DeliveryZoneModel.create(zone({ fee: "not money" }))).rejects.toThrow();
    await expect(DeliveryZoneModel.create(zone({ fee: Number.NaN }))).rejects.toThrow();
    expect(await DeliveryZoneModel.countDocuments()).toBe(0);
  });
});

describe("reads give the same Decimal and the same wire string from Double and from Decimal128", () => {
  it("a repository (lean) read revives a real Decimal from either", async () => {
    const asDouble = (await DeliveryZoneModel.create(zone({ fee: toMoney("60"), minimumOrder: toMoney("0.30") })))._id;
    const asDecimal = await insertLegacyZone("60.00", "0.30");
    for (const id of [asDouble, asDecimal]) {
      const read = await deliveryZoneRepository.findOne({ where: { _id: id } });
      expect(typeof read?.fee.mul).toBe("function"); // a real Decimal, ready for the engines
      expect(read?.fee.toFixed(2)).toBe("60.00");
      expect(read?.minimumOrder?.toFixed(2)).toBe("0.30");
    }
  });

  it("a hydrated read's getter returns a Decimal from either", async () => {
    const asDouble = (await DeliveryZoneModel.create(zone({ fee: toMoney("60") })))._id;
    const asDecimal = await insertLegacyZone("60.00");
    for (const id of [asDouble, asDecimal]) {
      const doc = await DeliveryZoneModel.findById(id);
      expect(typeof doc?.fee.mul).toBe("function");
      expect(doc?.fee.toFixed(2)).toBe("60.00");
    }
  });

  it("serializes identically — lean+sanitize and hydrated toJSON, Double and Decimal128 — as a decimal string", async () => {
    const asDouble = (await DeliveryZoneModel.create(zone({ fee: toMoney("60"), minimumOrder: toMoney("12.50") })))._id;
    const asDecimal = await insertLegacyZone("60.00", "12.50");
    const wire = async (id: mongoose.Types.ObjectId) => {
      const lean = JSON.parse(JSON.stringify(sanitizeLeanResult(await DeliveryZoneModel.findById(id).lean())));
      const hydrated = JSON.parse(JSON.stringify(await DeliveryZoneModel.findById(id)));
      return [lean.fee, lean.minimumOrder, hydrated.fee, hydrated.minimumOrder];
    };
    expect(await wire(asDouble)).toEqual(["60", "12.5", "60", "12.5"]);
    expect(await wire(asDecimal)).toEqual(["60", "12.5", "60", "12.5"]);
  });

  it("a raw .lean() read (no sanitizer) sees Decimal128, exactly the shape it always did", async () => {
    const created = await DeliveryZoneModel.create(zone({ fee: toMoney("19.99") }));
    const lean = await DeliveryZoneModel.findById(created._id).lean();
    expect((lean?.fee as unknown as { _bsontype?: string })._bsontype).toBe("Decimal128");
    expect(String(lean?.fee)).toBe("19.99");
  });

  it("a list mixing both kinds reads uniformly", async () => {
    await DeliveryZoneModel.create(zone({ fee: toMoney("0.10"), sortOrder: 1 }));
    await insertLegacyZone("0.20");
    const all = await deliveryZoneRepository.findAll({});
    expect(all.map((z) => z.fee.toFixed(2)).sort()).toEqual(["0.10", "0.20"]);
    expect(all.every((z) => typeof z.fee.plus === "function")).toBe(true);
  });

  it("an update returned by findOneAndUpdate (lean) is normalised too", async () => {
    const created = await DeliveryZoneModel.create(zone());
    const updated = await DeliveryZoneModel.findOneAndUpdate({ _id: created._id }, { $set: { fee: toMoney("70") } }, { returnDocument: "after" }).lean();
    expect(String(updated?.fee)).toBe("70.00");
  });

  it("a lean findOneAndUpdate with includeResultMetadata is normalised inside its { value } wrapper", async () => {
    const created = await DeliveryZoneModel.create(zone());
    const raw = (await DeliveryZoneModel.findOneAndUpdate({ _id: created._id }, { $set: { fee: toMoney("71") } }, { returnDocument: "after", includeResultMetadata: true }).lean()) as unknown as { ok: number; value: { fee: unknown } };
    expect(raw.ok).toBe(1);
    expect((raw.value.fee as { _bsontype?: string })._bsontype).toBe("Decimal128");
    expect(String(raw.value.fee)).toBe("71.00");
  });

  it("re-saving a legacy record changes only what was edited; untouched money stays readable", async () => {
    const id = await insertLegacyZone("60.00", "100.00");
    const doc = await DeliveryZoneModel.findById(id);
    doc!.fee = toMoney("65");
    await doc!.save();
    expect(await storedTypes(id)).toEqual({ fee: "double", minimumOrder: "decimal" });
    const read = await deliveryZoneRepository.findOne({ where: { _id: id } });
    expect([read?.fee.toFixed(2), read?.minimumOrder?.toFixed(2)]).toEqual(["65.00", "100.00"]);
  });
});

describe("the read normalisation itself", () => {
  it("converts a double or a BSON Double to Decimal128 at two decimals, and leaves everything else alone", () => {
    expect(String(toLegacyMoneyValue(19.99))).toBe("19.99");
    expect(String(toLegacyMoneyValue(560))).toBe("560.00");
    expect(String(toLegacyMoneyValue(new mongoose.mongo.Double(0.1)))).toBe("0.10");
    expect(String(toLegacyMoneyValue(0.30000000000000004))).toBe("0.30");
    const legacy = d128("12.345");
    expect(toLegacyMoneyValue(legacy)).toBe(legacy); // as stored, never reinterpreted
    expect(toLegacyMoneyValue("560.00")).toBe("560.00");
    expect(toLegacyMoneyValue(null)).toBeNull();
    expect(toLegacyMoneyValue(undefined)).toBeUndefined();
    expect(toLegacyMoneyValue(Number.NaN)).toBeNaN();
  });

  it("rewrites nested and array paths, and only the listed ones", () => {
    const doc = { total: 10, weight: 1.5, fulfilment: { fee: 5 }, lines: [{ price: 1.1 }, { price: 2 }], missing: undefined };
    normalizeMoneyPaths(doc, ["total", "fulfilment.fee", "lines[].price", "absent.path"]);
    expect(String(doc.total)).toBe("10.00");
    expect(doc.weight).toBe(1.5);
    expect(String(doc.fulfilment.fee)).toBe("5.00");
    expect(doc.lines.map((line) => String(line.price))).toEqual(["1.10", "2.00"]);
  });

  it("every model that stores money is covered, and nothing else is marked as money", () => {
    const covered = Object.fromEntries(ALL_MODELS.map((model) => [model.modelName, moneyPaths(model.schema as unknown as mongoose.Schema)]).filter(([, paths]) => paths.length > 0));
    expect(Object.keys(covered).sort()).toEqual(["DeliveryZone", "FulfilmentSettings", "Order", "OrderLine", "Product", "Promotion", "Return", "Variant"]);
    expect(Object.values(covered).flat()).toHaveLength(25);
    for (const model of ALL_MODELS) {
      model.schema.eachPath((_path, type) => {
        if ((type.options as Record<string, unknown>)?.[MONEY_PATH_MARKER]) expect(type.instance).toBe("Double");
      });
    }
  });
});
