import { Type } from "class-transformer";
import { IsOptional, ValidateNested } from "class-validator";
import { IsSizeChart } from "../size-guides/is-size-chart";
import { LocalizedStringDto } from "@kira-joo/backend-toolkit-core";

export class UpdateSizeGuideDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  description?: LocalizedStringDto;

  @IsOptional()
  @IsSizeChart()
  chartData?: Record<string, unknown>;
}
