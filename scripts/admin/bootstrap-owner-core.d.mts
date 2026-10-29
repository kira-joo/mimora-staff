// Types for bootstrap-owner-core.mjs (plain JS so it runs without a TypeScript runtime in production).
import type { MongoClient, Db, ObjectId } from "mongodb";

export declare const INVITE_TTL_MS: number;
export declare const COLLECTIONS: { staff: string; roles: string; activity: string };
export declare const LOCK_COLLECTION: string;
export declare const OWNER_ROLE: string;
export declare function hashInviteToken(token: string): string;
export declare function mintInviteToken(): string;
export declare class BootstrapRefusal extends Error {}
export interface BootstrapTarget { local: boolean; hosts: string[]; dbName: string }
export declare function describeTarget(uri: string | undefined, dbName: string | undefined): BootstrapTarget;
export declare function assertConfirmed(target: BootstrapTarget, confirmation: unknown): void;
export interface BootstrapOptions { email: string; name?: string; reissue?: boolean; dryRun?: boolean; now?: Date; mintToken?: () => string }
export type BootstrapOutcome =
  | { action: "created" | "reissued"; staffId: ObjectId; email: string; token: string; expiresAt: Date }
  | { action: "would-create"; email: string; expiresAt: Date };
export declare function bootstrapOwner(client: MongoClient, db: Db, options: BootstrapOptions): Promise<BootstrapOutcome>;
export declare function parseArgs(argv: string[]): Record<string, string | true>;
