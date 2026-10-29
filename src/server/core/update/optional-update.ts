import { BadRequestError } from "@kira-joo/backend-toolkit-core";

/**
 * The update contract for an optional field, in one place:
 * - omitted (`undefined`) — leave the stored value as it is;
 * - `null` — clear it;
 * - a value — set it.
 *
 * JSON cannot carry `undefined`, so `null` is the only way a client can say
 * "remove this"; reading it as a value (or as omission) is what made a
 * promotion's limits and end date impossible to clear.
 */
export type Patch<T> = { [K in keyof T]?: T[K] | null };

/** Applies a patch to a stored sub-document (conditions, limits). Cleared keys are absent from the result. */
export function mergeOptional<T extends object>(current: T | undefined, patch: Patch<T>): T {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

/** Converts a present value, passing `undefined` (omitted) and `null` (clear) through untouched. */
export function mapPresent<T, U>(value: T | null | undefined, convert: (present: T) => U): U | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return convert(value);
}

/**
 * A top-level update as MongoDB operators: omitted keys are left out, a
 * value goes to `$set`, and `null` on a key listed in `clearable` goes to
 * `$unset` — the field is removed, so its documented "absent" meaning
 * applies (no minimum, no cutoff, no coordinates…). `null` on any other key
 * is refused: a required field cannot be cleared, and storing a literal
 * null there would be read as a value.
 */
export function toUpdateOperators(patch: Record<string, unknown>, clearable: readonly string[]): { $set: Record<string, unknown>; $unset?: Record<string, ""> } {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ""> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      if (!clearable.includes(key)) throw new BadRequestError(`${key} cannot be cleared.`);
      $unset[key] = "";
    } else {
      $set[key] = value;
    }
  }
  return Object.keys($unset).length ? { $set, $unset } : { $set };
}
