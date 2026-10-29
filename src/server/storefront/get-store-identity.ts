import { configuredStoreId } from "../core/db/store-identity";

/**
 * Which store this backend serves. Reaching this function means the route factory already ran `connectToDatabase`,
 * which refuses to connect unless the database's marker names the configured `STORE_ID` — so a 200 here is a statement
 * about the database, not just about the environment. The storefront compares it with its own `STORE_ID`.
 */
export function getStoreIdentity(): { storeId: string } {
  return { storeId: configuredStoreId(process.env) };
}
