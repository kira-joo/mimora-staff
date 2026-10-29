import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsString, MinLength } from "class-validator";

/** Shared params DTO for any `[slug]` dynamic segment on the storefront surface. */
export class SlugParamsDto {
  @IsString()
  @Trim()
  @MinLength(1)
  slug!: string;
}
