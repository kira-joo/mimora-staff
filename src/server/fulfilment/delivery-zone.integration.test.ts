// @vitest-environment node
import { createMongooseRepository } from "@kira-joo/backend-toolkit-mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { DeliveryZoneModel, type DeliveryZoneSchema } from "./delivery-zone.schema";

const deliveryZoneRepository = createMongooseRepository<DeliveryZoneSchema>({
  model: DeliveryZoneModel,
  entityName: "DeliveryZone",
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase(); // also asserts every declared index exists, including this schema's
});

afterEach(async () => {
  await DeliveryZoneModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("DeliveryZone", () => {
  it("persists with real identity — the thing a subdocument array could never carry", async () => {
    const zone = await DeliveryZoneModel.create({
      name: { en: "Cairo", ar: "القاهرة" },
      areas: ["Maadi", "Zamalek"],
      fee: toMoney("25.00"),
      minimumOrder: toMoney("100.00"),
      leadDays: 2,
    });

    expect(zone._id).toBeInstanceOf(mongoose.Types.ObjectId);

    const found = await DeliveryZoneModel.findById(zone._id).lean();
    expect(found?.name.en).toBe("Cairo");
    expect(found?.areas).toEqual(["Maadi", "Zamalek"]);
    expect(found?.leadDays).toBe(2);
    expect(found?.active).toBe(true); // default
  });

  it("soft-deletes through the repository rather than hard-deleting, per @MongoSchema({softDelete: true})", async () => {
    const zone = await DeliveryZoneModel.create({
      name: { en: "Alexandria", ar: "الإسكندرية" },
      fee: toMoney("40.00"),
      minimumOrder: toMoney("0.00"),
      leadDays: 4,
    });

    await deliveryZoneRepository.softDelete({ where: { _id: zone._id } });

    // The document still exists at the storage layer — a real hard delete would leave nothing here.
    const raw = await DeliveryZoneModel.findById(zone._id).lean();
    expect(raw).not.toBeNull();
    expect((raw as unknown as { deletedAt?: Date })?.deletedAt).toBeInstanceOf(Date);

    // But the repository's normal find path treats it as gone.
    await expect(deliveryZoneRepository.findOne({ where: { _id: zone._id } })).rejects.toThrow();
  });
});
