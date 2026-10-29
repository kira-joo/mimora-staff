// Types for store-identity-core.mjs (plain JS so it runs without a TypeScript runtime in production).
import type { Db } from "mongodb";
import type { BootstrapTarget } from "./bootstrap-owner-core.mjs";

export declare const MARKER_COLLECTION: string;
export declare const MARKER_ID: string;
export declare const STORE_ID_PATTERN: RegExp;
export declare const ADOPTED_VIA: string;
export declare const PREFLIGHT_COLLECTIONS: { profile: string; products: string; orders: string; customers: string };
export declare class StoreIdentityRefusal extends Error {}
export declare function parseArgs(argv: string[]): Record<string, string | true>;
export declare function assertStoreId(storeId: unknown): string;
export declare function assertConfirmed(dbName: string, confirmDb: unknown): void;
export declare function resolveTarget(uri: string | undefined, dbName: string | undefined): BootstrapTarget;
export interface StoreIdentityMarker { storeId: string; adoptedAt: Date; adoptedVia: string }
export interface StoreIdentityPreflight {
  dbName: string;
  marker: StoreIdentityMarker | null;
  profile: { nameAr: string | null; nameEn: string | null; currency: string | null } | null;
  counts: { products: number; orders: number; customers: number };
}
export declare function preflight(db: Db): Promise<StoreIdentityPreflight>;
export interface AdoptOptions { storeId: string; confirmDb: string; dryRun?: boolean; now?: Date; via?: string }
export type AdoptOutcome =
  | { action: "would-adopt"; storeId: string }
  | { action: "adopted" | "already-adopted"; storeId: string; marker?: StoreIdentityMarker & { _id: string } };
export declare function adoptStoreIdentity(db: Db, options: AdoptOptions): Promise<AdoptOutcome>;
