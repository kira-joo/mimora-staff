import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { SizeGuideModel } from "../../catalog/size-guide.schema";
import { sizeGuideRepository } from "../../core/repositories";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const LOCALIZED = { ar: "نص", en: "Text" };
const CHART_DATA = { headers: ["Size", "Chest"], rows: [["S", "34-36"]] };

describe("Admin Size Guides", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await SizeGuideModel.deleteMany({});
  });

  describe("update", () => {
    it("updates only the fields provided, leaving the rest untouched", async () => {
      const created = await SizeGuideModel.create({ name: LOCALIZED, description: LOCALIZED, chartData: CHART_DATA });
      const newChartData = { headers: ["Size", "Waist"], rows: [["M", "30-32"]] };

      const updated = await sizeGuideRepository.update(
        { where: { _id: created._id.toString() } },
        // A DTO-shaped patch: absent fields arrive as `undefined` and must leave the stored value untouched.
        { name: undefined, description: undefined, chartData: newChartData }
      );

      expect(updated.chartData).toEqual(newChartData);
      expect(updated.name.ar).toBe(LOCALIZED.ar);
      expect(updated.name.en).toBe(LOCALIZED.en);
      expect(updated.description?.en).toBe(LOCALIZED.en);
    });
  });
});
