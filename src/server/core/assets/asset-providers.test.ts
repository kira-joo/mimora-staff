import { describe, expect, it } from "vitest";
import { missingCloudinaryVariables } from "./asset-providers";

describe("missingCloudinaryVariables", () => {
  const all = { CLOUDINARY_CLOUD_NAME: "c", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" };

  it("is empty when all three are set", () => {
    expect(missingCloudinaryVariables(all)).toEqual([]);
  });

  it("names every missing or empty variable, and never a value", () => {
    expect(missingCloudinaryVariables({})).toEqual(["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]);
    expect(missingCloudinaryVariables({ ...all, CLOUDINARY_API_SECRET: "" })).toEqual(["CLOUDINARY_API_SECRET"]);
  });
});
