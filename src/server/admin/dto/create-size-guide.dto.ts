import { Type } from "class-transformer";
import { ValidateNested } from "class-validator";
import { IsSizeChart } from "../size-guides/is-size-chart";
import { LocalizedStringDto } from "@kira-joo/backend-toolkit-core";

export class CreateSizeGuideDto {
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name!: LocalizedStringDto;

  @ValidateNested()
  @Type(() => LocalizedStringDto)
  description!: LocalizedStringDto;

  /** Structured size chart JSON — `{ headers: [...], rows: [[...], ...] }`. Mixed on the schema, so its shape and size are validated HERE (`sizeChartProblems`). */
  @IsSizeChart()
  chartData!: Record<string, unknown>;
}
