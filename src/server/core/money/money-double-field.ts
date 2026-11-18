import { MONEY_SCALE, MoneyError, roundMoney, type Money } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Mimora's money storage: **BSON Double at rest, `Decimal` in memory, a decimal string on the wire.**
 *
 * This replaces the toolkit's `moneyField()` (Decimal128 at rest) for Mimora only — an owner decision, recorded in
 * this repository's CLAUDE.md. The shared package is untouched; other applications keep Decimal128.
 *
 * What does NOT change is everything above the storage layer: every engine still receives `Decimal` and calculates
 * exactly as before, every value is rounded once at this boundary exactly as before, and every response still
 * carries the same decimal string. Storing a two-decimal amount as a double is lossless (each such value round-trips
 * through `Number` and back to the same two decimals); arithmetic on doubles is not, which is why none happens here.
 *
 * ## Both storage types are read, for as long as old records exist
 *
 * Records written before this change hold `Decimal128`, and a record re-saved before the data migration keeps
 * `Decimal128` on every money field it did not touch. So every read path accepts both:
 *
 * - **Hydrated documents** — Mongoose casts a stored `Decimal128` to the field's `Double`, and the getter returns
 *   `Decimal`.
 * - **Lean reads** (the toolkit's default) — never run getters. A query hook ({@link moneyStoragePlugin}) rewrites
 *   every money path of a lean result into `Decimal128`, the shape lean reads have always produced, so the toolkit's
 *   `sanitizeLeanResult` and every raw `.lean()` caller see exactly what they saw before.
 * - **`toJSON()`** — the same rewrite runs before the toolkit's own transform, so a hydrated document serializes to
 *   the same decimal string as before, never a bare JSON number.
 * - **Aggregations** do not pass through either; the few that return money convert with `$toDecimal` themselves.
 */

/** Schema-option marker for a money path, read by {@link moneyPaths}. */
export const MONEY_PATH_MARKER = "mimoraMoney";

export interface MoneyDoubleFieldOptions {
  /** Whether the field itself is required. Defaults to `false`. */
  required?: boolean;
  /** Stores `0` when the field is absent, so an amount that ought to default to nothing reads back as zero. */
  defaultZero?: boolean;
}

/** Everything Mongoose can hand the setter or getter: an engine `Decimal`, a DTO string, or a stored BSON value. */
type MoneyStorageInput = Money | mongoose.Types.Decimal128 | mongoose.mongo.Double | number | string | null | undefined;

/**
 * What {@link moneyDoubleField} returns — a type alias, not an interface, for the same reason the toolkit's
 * `MoneyFieldDefinition` is one: an alias is assignable both to `@MongoField(...)`'s options and to a field inside a
 * hand-written `new mongoose.Schema({...})`.
 */
export type MoneyDoubleFieldDefinition = {
  type: typeof mongoose.Schema.Types.Double;
  required: boolean;
  set: (value: MoneyStorageInput) => number | null | undefined;
  get: (value: MoneyStorageInput) => Money | null | undefined;
  default?: () => number;
  [MONEY_PATH_MARKER]: true;
};

/**
 * A money field stored as BSON Double.
 *
 * - **In:** the setter rounds once to {@link MONEY_SCALE} (half-up, through `roundMoney`, exactly as before) and hands
 *   Mongoose a number; `Schema.Types.Double` then stores a real BSON double — never Int32, even for `560` or `0`,
 *   which a plain `Number` path would store as Int32. A non-finite value is refused by `toMoney`, as before.
 * - **Out (hydrated):** the getter returns `Decimal`.
 */
export function moneyDoubleField(options?: MoneyDoubleFieldOptions): MoneyDoubleFieldDefinition {
  const { required = false, defaultZero = false } = options ?? {};
  const field: MoneyDoubleFieldDefinition = {
    type: mongoose.Schema.Types.Double,
    required,
    set: (value) => (value === null || value === undefined ? value : toStorableNumber(value)),
    get: (value) => (value === null || value === undefined ? value : roundMoney(toDecimalInput(value))),
    [MONEY_PATH_MARKER]: true,
  };
  // A function, so each document gets its own value; the setter still runs over it.
  if (defaultZero) field.default = () => 0;
  return field;
}

/**
 * The largest magnitude a two-decimal amount can have and still survive a double exactly (15 significant digits:
 * 9,999,999,999,999.99). Beyond it a double silently drops the cents — `1000000000000000.01` would be stored as
 * `1000000000000000` — so a larger amount is refused, never stored approximately. Decimal128 had no such limit; no
 * real Mimora amount comes near it. The data migration refuses the same range.
 */
export const MAX_STORABLE_MONEY = 1e13;

/** Rounds once to scale and returns the number to store; refuses (MoneyError, via toMoney) non-finite input and amounts a double cannot hold exactly. */
function toStorableNumber(value: Exclude<MoneyStorageInput, null | undefined>): number {
  const rounded = roundMoney(toDecimalInput(value));
  if (rounded.abs().greaterThanOrEqualTo(MAX_STORABLE_MONEY)) {
    throw new MoneyError(`Amount ${rounded.toFixed(MONEY_SCALE)} is too large to store exactly (the limit is below ${MAX_STORABLE_MONEY}).`);
  }
  return Number(rounded.toFixed(MONEY_SCALE));
}

/**
 * Normalises a stored BSON value to something `toMoney` reads exactly. A `Decimal128` reads through its string; a
 * `Double` (or a plain number from a lean read) through `String(number)`, which yields the shortest decimal that
 * round-trips — "19.99", never "19.989999999999998…".
 */
function toDecimalInput(value: Exclude<MoneyStorageInput, null | undefined>): Money | number | string {
  const bsonType = (value as { _bsontype?: string })._bsontype;
  if (bsonType === "Decimal128") return value.toString();
  if (bsonType === "Double") return String((value as mongoose.mongo.Double).valueOf());
  if (typeof value === "number") return String(value);
  return value as Money | string;
}

/** Every money path of a schema, dotted, including single-nested and array sub-schemas (`lines[].price`). */
export function moneyPaths(schema: mongoose.Schema, prefix = ""): string[] {
  const paths: string[] = [];
  schema.eachPath((path, schemaType) => {
    const options = schemaType.options as Record<string, unknown>;
    if (options?.[MONEY_PATH_MARKER] === true) paths.push(`${prefix}${path}`);
    const child = (schemaType as unknown as { schema?: mongoose.Schema }).schema;
    if (child) paths.push(...moneyPaths(child, `${prefix}${path}${(schemaType as unknown as { $isMongooseDocumentArray?: boolean }).$isMongooseDocumentArray ? "[]" : ""}.`));
  });
  return paths;
}

/**
 * The lean-read shape for one stored money value: `Decimal128`, as every lean read produced before this change. A
 * double from a new record is converted through its shortest decimal string and rounded to scale; a `Decimal128`
 * from an old record is left exactly as stored. Anything else (absent, null, an unexpected string) is returned as-is
 * rather than guessed at.
 */
export function toLegacyMoneyValue(value: unknown): unknown {
  if (typeof value === "number" || (value as { _bsontype?: string } | null)?._bsontype === "Double") {
    const number = typeof value === "number" ? value : (value as mongoose.mongo.Double).valueOf();
    if (!Number.isFinite(number)) return value;
    return mongoose.Types.Decimal128.fromString(roundMoney(String(number)).toFixed(MONEY_SCALE));
  }
  return value;
}

/** Rewrites each money path of a plain object in place (see {@link toLegacyMoneyValue}). Returns the object. */
export function normalizeMoneyPaths<T>(doc: T, paths: readonly string[]): T {
  if (doc === null || typeof doc !== "object") return doc;
  for (const path of paths) rewrite(doc as Record<string, unknown>, path.split("."));
  return doc;
}

function rewrite(node: unknown, segments: string[]): void {
  if (node === null || typeof node !== "object") return;
  const [head, ...rest] = segments;
  if (head === undefined) return;
  const isArray = head.endsWith("[]");
  const key = isArray ? head.slice(0, -2) : head;
  const record = node as Record<string, unknown>;
  if (!(key in record)) return;
  if (isArray) {
    if (Array.isArray(record[key])) for (const item of record[key] as unknown[]) rewrite(item, rest);
    return;
  }
  if (rest.length === 0) record[key] = toLegacyMoneyValue(record[key]);
  else rewrite(record[key], rest);
}

const LEAN_QUERY_OPERATIONS = ["find", "findOne", "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete"] as const;

/**
 * Mongoose plugin: for any schema with money paths, normalise lean query results and `toJSON()` output to the
 * pre-change shape (see the module comment). A schema with no money path is left alone.
 *
 * Registered globally, below, by this module — so it is guaranteed to be in place before any schema that uses
 * {@link moneyDoubleField} is compiled into a model, because that schema had to import this module first.
 */
export function moneyStoragePlugin(schema: mongoose.Schema): void {
  const paths = moneyPaths(schema);
  if (paths.length === 0) return;

  for (const operation of LEAN_QUERY_OPERATIONS) {
    schema.post(operation, function (this: mongoose.Query<unknown, unknown>, result: unknown) {
      if (!this.mongooseOptions().lean || result === null || result === undefined) return;
      if (Array.isArray(result)) for (const doc of result) normalizeMoneyPaths(doc, paths);
      // `includeResultMetadata: true` wraps the document: `{ value, ok, lastErrorObject }`.
      else if (this.getOptions().includeResultMetadata) normalizeMoneyPaths((result as { value?: unknown }).value, paths);
      else normalizeMoneyPaths(result, paths);
    });
  }

  const toJSON = (schema.get("toJSON") ?? {}) as mongoose.ToObjectOptions;
  const previous = toJSON.transform;
  schema.set("toJSON", {
    ...toJSON,
    transform: (document: unknown, serialized: Record<string, unknown>, options: unknown) => {
      normalizeMoneyPaths(serialized, paths);
      return typeof previous === "function" ? (previous as (...args: unknown[]) => unknown)(document, serialized, options) : serialized;
    },
  });
}

mongoose.plugin(moneyStoragePlugin, { deduplicate: true });
