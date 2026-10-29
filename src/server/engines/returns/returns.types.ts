/** Mirrors `ReturnSchema.status` exactly (`commerce/return.schema.ts`). */
export type ReturnStatus = "REQUESTED" | "APPROVED" | "RECEIVED" | "REJECTED" | "REFUNDED";

/** Mirrors `ReturnLineSchema.disposition` exactly. */
export type ReturnDisposition = "RESTOCK" | "DISCARD";

export type ReturnEligibilityRejection = "NOT_DELIVERED" | "WINDOW_EXPIRED";

export type ReturnEligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: ReturnEligibilityRejection };

export interface ReturnLineQuantityCheck {
  orderLineId: string;
  requestedQuantity: number;
}

/** What was actually ordered and how much of it has already been returned. */
export interface OrderLineReturnState {
  orderLineId: string;
  orderedQuantity: number;
  alreadyReturnedQuantity: number;
}

export type QuantityRejection = "LINE_NOT_FOUND" | "EXCEEDS_REMAINING" | "NOT_POSITIVE";

export type QuantityValidation =
  | { valid: true }
  | { valid: false; orderLineId: string; reason: QuantityRejection };
