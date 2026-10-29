import { registerDecorator, type ValidationOptions } from "class-validator";
import { sizeChartProblems } from "./size-chart";

/** Validates a DTO property as a size chart (`sizeChartProblems`); the 400 names the first problem. */
export function IsSizeChart(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: "isSizeChart",
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => sizeChartProblems(value).length === 0,
        defaultMessage: (args) => sizeChartProblems(args?.value)[0] ?? "chartData is not a valid size chart.",
      },
    });
}
