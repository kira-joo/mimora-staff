import mongoose from "mongoose";
import { ensureIndexes } from "./ensure-indexes";
import { assertStoreIdentity } from "./store-identity";

/**
 * The connection cache lives on `globalThis` rather than in a module-level
 * variable, because Next's dev-mode hot reload discards the module registry on
 * every change. Without this, each edit opens another connection and the pool
 * is exhausted within a few minutes of ordinary work.
 */
interface MongooseCache {
  connection: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalWithMongoose = globalThis as typeof globalThis & {
  __storePlatformStaffMongoose?: MongooseCache;
};

const cache: MongooseCache = (globalWithMongoose.__storePlatformStaffMongoose ??= {
  connection: null,
  promise: null,
});

/**
 * Establishes or reuses the database connection. Wired into
 * `configureNextBackendToolkit` and therefore called at the start of every
 * request, so it must be cheap once connected.
 *
 * It also refuses to hand out a connection to a database that does not belong to
 * this deployment's store (`store-identity.ts`) — a refusal clears the memo like any
 * other startup failure, so a corrected configuration recovers without a restart.
 *
 * Concurrent callers share one in-flight promise. A cold serverless start
 * routinely handles several requests at once, and without this each would open
 * its own connection.
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.connection) return cache.connection;

  if (!cache.promise) {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
      throw new Error(
        "MONGODB_URI is not set. Copy .env.example to .env and point it at a MongoDB REPLICA SET — " +
          "`docker compose up -d` starts one. Transactions do not run on a standalone node, and " +
          "order placement is a single transaction by design."
      );
    }

    cache.promise = mongoose
      .connect(uri, {
        // Fail fast with a clear error rather than hanging for the 30s default
        // when the database is simply not running.
        serverSelectionTimeoutMS: 8_000,
        dbName: process.env.MONGODB_DB || "store-platform-staff",
        // Mongoose's defaults create every model's collection and start its index builds the moment it connects —
        // before the store-identity check below could refuse a database that is not this store's. Off here; the
        // build happens explicitly in ensureIndexes, only after the identity is verified.
        autoCreate: false,
        autoIndex: false,
      })
      /*
       * Indexes are part of being connected, not a separate startup step.
       *
       * Several of this application's uniqueness guarantees are the index and
       * nothing else — idempotency, customer phone/email, order-number allocation,
       * SKU uniqueness, variantKey uniqueness all treat a duplicate-key error as
       * control flow — and Mongoose builds declared indexes in the background
       * without any operation waiting for them. Folding the wait into this promise
       * means every request path already awaits it, because every request path
       * already awaits this.
       *
       * Inside the memoised promise rather than after it, so concurrent callers
       * on a cold start share the one wait instead of each starting their own.
       */
      .then(async (connection) => {
        // Whose data is this? Checked FIRST, before ensureIndexes: a deployment pointed at the wrong database (another
        // store's, or an unmarked one) must refuse without writing anything there — not even an index or a collection.
        // A read of one document needs no index. Once per process: the memo below is the only caller that reaches it.
        await assertStoreIdentity(connection.connection.db!, process.env);
        await ensureIndexes();
        return connection;
      })
      .catch((error: unknown) => {
        // Clear the memo so a later request can retry. Leaving a rejected
        // promise cached would make one transient startup failure permanent
        // for the lifetime of the process.
        cache.promise = null;
        throw error;
      });
  }

  cache.connection = await cache.promise;
  return cache.connection;
}
