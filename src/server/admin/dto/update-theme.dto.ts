import { Transform, Type } from "class-transformer";
import { expandHexShorthand } from "../../engines/theme/color-math";
import { TYPOGRAPHY_CHOICES, type TypographyChoice } from "../../content/storefront-grounds";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, Matches, Max, Min, ValidateNested } from "class-validator";

/**
 * `#RGB` or `#RRGGBB`. A three-digit colour is expanded to six at the
 * boundary (`ExpandHex`) before this pattern runs, so the engine's strict
 * six-digit `parseHex` and the stored theme only ever see `#RRGGBB` — the
 * DTO and the runtime accept exactly the same colours. A malformed value
 * still fails here with a field-mapped 400, never in the engine.
 */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** `#fff` → `#ffffff`; anything else passes through for the pattern to judge. */
const ExpandHex = () => Transform(({ value }) => (typeof value === "string" ? expandHexShorthand(value) : value));

class BrandDto {
  @ExpandHex()
  @Matches(HEX_COLOR_PATTERN, { message: "primary must be a hex colour, e.g. #111111" })
  primary!: string;

  @ExpandHex()
  @Matches(HEX_COLOR_PATTERN, { message: "accent must be a hex colour, e.g. #111111" })
  accent!: string;

  @ExpandHex()
  @Matches(HEX_COLOR_PATTERN, { message: "surface must be a hex colour, e.g. #FFFFFF" })
  surface!: string;

  @ExpandHex()
  @Matches(HEX_COLOR_PATTERN, { message: "text must be a hex colour, e.g. #111111" })
  text!: string;

  @IsNumber()
  @Min(0.5)
  @Max(2)
  radiusScale!: number;

  /** D-S4: one of the curated, Arabic-covering pairings (`TYPOGRAPHY_CHOICES`). */
  @IsIn(TYPOGRAPHY_CHOICES, { message: `typographyChoice must be one of: ${TYPOGRAPHY_CHOICES.join(", ")}` })
  typographyChoice!: TypographyChoice;
}

class TokenOverrideDto {
  /** Brand fills only — never text, border, state, or a ground-dependent surface (MDS §20, `[ASSUMPTION → D-2]`). */
  @IsIn(["primary", "accent"])
  key!: "primary" | "accent";

  @ExpandHex()
  @Matches(HEX_COLOR_PATTERN, { message: "value must be a hex colour, e.g. #111111" })
  value!: string;
}

class ThemeDto {
  @IsIn(["light", "dark"])
  defaultGround!: "light" | "dark";

  @IsBoolean()
  darkEnabled!: boolean;

  @IsBoolean()
  allowVisitorChoice!: boolean;

  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => TokenOverrideDto)
  tokenOverrides!: TokenOverrideDto[];
}

/**
 * Both `brand` and `theme` are required whole objects, not a field-by-field
 * partial patch like `UpdateStoreProfileDto` — a partial write here could
 * leave `brand.surface` and a just-written `tokenOverrides[]` override
 * measured against each other inconsistently across two separate requests.
 * The admin theme screen previews all four storefront combinations before
 * writing (MDS §20), so it always has the complete shape in hand to submit.
 */
export class UpdateThemeDto {
  @ValidateNested()
  @Type(() => BrandDto)
  brand!: BrandDto;

  @ValidateNested()
  @Type(() => ThemeDto)
  theme!: ThemeDto;
}
