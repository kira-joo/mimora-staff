import type { MovementReason } from "src/api/inventory.endpoints";

export const MOVEMENT_REASON_LABEL: Record<MovementReason, string> = {
  SALE: "Sale",
  RETURN: "Returned to stock",
  ADJUSTMENT: "Correction",
  RECEIPT: "Received",
  DAMAGE: "Damage",
};

export const MOVEMENT_REASON_OPTIONS = (Object.keys(MOVEMENT_REASON_LABEL) as MovementReason[]).map((value) => ({ value, label: MOVEMENT_REASON_LABEL[value] }));

/** A signed change, always with its sign: "+5", "−3" (a true minus, so it lines up with the plus). */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : "0";
}
