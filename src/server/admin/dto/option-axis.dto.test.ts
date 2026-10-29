import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateProductDto } from "./create-product.dto";
import { UpdateProductDto } from "./update-product.dto";

const L = { en: "Olive", ar: "زيتي" };
const base = { name: L, description: L, slug: "tee", categoryId: "65f0000000000000000000a1" };

async function errorsFor(dto: new () => object, optionAxes: unknown, extra: object = {}) {
  const errors = await validate(plainToInstance(dto, { ...extra, optionAxes }));
  const flatten = (list: typeof errors, path = ""): string[] =>
    list.flatMap((error) => [...(error.constraints ? [`${path}${error.property}`] : []), ...flatten(error.children ?? [], `${path}${error.property}.`)]);
  return flatten(errors);
}

const axis = (values: unknown) => [{ key: "colour", name: { en: "Colour", ar: "اللون" }, values }];

describe.each([
  ["CreateProductDto", CreateProductDto, base],
  ["UpdateProductDto", UpdateProductDto, {}],
] as const)("%s — optionAxes[].values", (_name, dto, extra) => {
  it("accepts labelled values with and without a swatch, and an axis with no values at all", async () => {
    expect(await errorsFor(dto, axis([{ key: "olive", label: L, swatch: "#808000" }, { key: "sand", label: { en: "Sand", ar: "رملي" } }]), extra)).toEqual([]);
    expect(await errorsFor(dto, [{ key: "size", name: { en: "Size", ar: "المقاس" } }], extra)).toEqual([]);
  });

  it.each(["808000", "#80800", "#GGGGGG", "olive", "#8080001", "rgb(0,0,0)"])("rejects swatch %s", async (swatch) => {
    expect(await errorsFor(dto, axis([{ key: "olive", label: L, swatch }]), extra)).toContain("optionAxes.0.values.0.swatch");
  });

  it("rejects a value with no label, and an empty or missing key", async () => {
    expect(await errorsFor(dto, axis([{ key: "olive" }]), extra)).toContain("optionAxes.0.values.0.label");
    expect(await errorsFor(dto, axis([{ key: "", label: L }]), extra)).toContain("optionAxes.0.values.0.key");
    expect(await errorsFor(dto, axis([{ label: L }]), extra)).toContain("optionAxes.0.values.0.key");
  });

  it("rejects a repeated value key within an axis", async () => {
    expect(await errorsFor(dto, axis([{ key: "olive", label: L }, { key: "olive", label: L }]), extra)).toContain("optionAxes.0.values");
  });
});
