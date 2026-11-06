import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { MAX_REORDER_ITEMS, ReorderCategoriesDto } from "./reorder-categories.dto";

const items = (count: number) => Array.from({ length: count }, (_, index) => ({ categoryId: "64b7f0f2a1b2c3d4e5f60718", sortOrder: index }));
const errorsFor = (count: number) => validate(plainToInstance(ReorderCategoriesDto, { items: items(count) }));

describe("ReorderCategoriesDto size bounds", () => {
  it("accepts exactly the maximum", async () => {
    expect(await errorsFor(MAX_REORDER_ITEMS)).toEqual([]);
  });

  it("refuses one more than the maximum, naming items", async () => {
    const errors = await errorsFor(MAX_REORDER_ITEMS + 1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.property).toBe("items");
    expect(Object.keys(errors[0]!.constraints ?? {})).toContain("arrayMaxSize");
  });

  it("still refuses an empty list", async () => {
    expect(Object.keys((await errorsFor(0))[0]!.constraints ?? {})).toContain("arrayMinSize");
  });

  it("is 500, so one request can never carry more than that into a single bulkWrite", () => {
    expect(MAX_REORDER_ITEMS).toBe(500);
  });
});
