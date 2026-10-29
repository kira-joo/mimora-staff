import { SortOrder } from "@kira-joo/toolkit-common";

/**
 * The one order cart lines are read in, everywhere: by `_id`, ascending — unique
 * and creation-ordered, so it is a TOTAL order in the sequence the customer added
 * things. Without it two lines created in the same millisecond came back in
 * either order, so a cart's lines could swap places between re-quotes (measured
 * 2026-10-21: the quote contract test failed 1 run in 3 on exactly that).
 */
export const CART_LINE_ORDER = { field: "_id", order: SortOrder.ASC } as const;
