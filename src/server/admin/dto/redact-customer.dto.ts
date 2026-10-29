import { IsIn } from "class-validator";

/**
 * A closed set, not free text: the reason is written to the activity log, which
 * must hold no personal data, and a free-text box is where staff type a name or a
 * phone number "for context".
 */
export const REDACTION_REASONS = ["CUSTOMER_REQUEST", "DUPLICATE_ACCOUNT", "FRAUD_OR_ABUSE", "OTHER"] as const;
export type RedactionReason = (typeof REDACTION_REASONS)[number];

/** The literal the caller must send — the API-level half of the console's confirmation step. */
export const REDACT_CONFIRMATION = "REDACT";

export class RedactCustomerDto {
  @IsIn(REDACTION_REASONS)
  reason!: RedactionReason;

  @IsIn([REDACT_CONFIRMATION], { message: `confirm must be exactly "${REDACT_CONFIRMATION}".` })
  confirm!: typeof REDACT_CONFIRMATION;
}
