import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { ORDER_NOTES_MAX_LENGTH, PlaceOrderDto } from "./place-order.dto";

const check = async (notes?: unknown) => {
  const dto = plainToInstance(PlaceOrderDto, { paymentMethod: "COD", termsVersionAccepted: 1, ...(notes === undefined ? {} : { notes }) });
  return { dto, errors: await validate(dto) };
};

describe("PlaceOrderDto.notes", () => {
  it("is optional", async () => {
    const { dto, errors } = await check();
    expect(errors).toEqual([]);
    expect(dto.notes).toBeUndefined();
  });

  it("is trimmed", async () => {
    const { dto, errors } = await check("  leave with the neighbour \n");
    expect(errors).toEqual([]);
    expect(dto.notes).toBe("leave with the neighbour");
  });

  it("accepts exactly the maximum, counted AFTER trimming", async () => {
    expect((await check("x".repeat(ORDER_NOTES_MAX_LENGTH))).errors).toEqual([]);
    expect((await check(`  ${"x".repeat(ORDER_NOTES_MAX_LENGTH)}  `)).errors).toEqual([]);
  });

  it("refuses one character over the maximum, naming the field", async () => {
    const { errors } = await check("x".repeat(ORDER_NOTES_MAX_LENGTH + 1));
    expect(errors.map((error) => error.property)).toEqual(["notes"]);
  });

  it("refuses a non-string", async () => {
    expect((await check(123)).errors.map((error) => error.property)).toEqual(["notes"]);
  });

  it("the maximum is 500", () => {
    expect(ORDER_NOTES_MAX_LENGTH).toBe(500);
  });
});
