import { ServiceUnavailableError } from "@kira-joo/backend-toolkit-core";
import { createCloudinaryPrivateAssets, createCloudinaryProvider } from "@kira-joo/backend-toolkit-cloudinary";
import type { AssetProvider } from "@kira-joo/backend-toolkit-core";

/**
 * Configured asset providers — new in Phase 4A.5.
 *
 * The architecture review found this pipeline complete and tested in
 * `@kira-joo/backend-toolkit-cloudinary`/`-core`/`-next` already: multipart
 * parsing, file validation, the provider-agnostic `AssetProvider` contract,
 * and Cloudinary's implementation of both the public (`AssetProvider`) and
 * private (`createCloudinaryPrivateAssets`) asset shapes. This module wires
 * that existing infrastructure to this application's own credentials — it
 * builds nothing new.
 *
 * **Two providers, two contracts, on purpose (not a redundant split):**
 * `assetProvider` returns `ImageAsset` with a permanent public `secureUrl`
 * — correct for catalog/brand/category imagery, which is meant to be
 * publicly and permanently deliverable from the CDN. `privateAssets` never
 * returns a stored URL at all — correct for payment proofs (see
 * `commerce/payment-proof.schema.ts`), which must never be reachable by a
 * guessable or cached link; retrieval mints a short-lived signed URL per
 * request instead. Passing a private asset through the public contract, or
 * vice versa, is exactly the mistake `backend-toolkit-cloudinary`'s own doc
 * comment names as the reason these are two separate functions.
 *
 * Lazily constructed (not at module load) so importing this file in a test
 * that never calls either function does not require Cloudinary credentials
 * to be set.
 */
let cachedAssetProvider: AssetProvider | undefined;
let cachedPrivateAssets: ReturnType<typeof createCloudinaryPrivateAssets> | undefined;

const CLOUDINARY_VARIABLES = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const;

/**
 * Which Cloudinary variables are missing, for the boot announcement
 * (src/instrumentation.ts). Without all three, every receipt upload — the only
 * way a bank-transfer / InstaPay / wallet order can be paid — fails at the
 * moment a customer tries it, which is a configured-OFF capability and must be
 * loud at startup, not discovered at checkout. Names only, never values.
 */
export function missingCloudinaryVariables(env: Record<string, string | undefined>): string[] {
  return CLOUDINARY_VARIABLES.filter((name) => !env[name]);
}

function cloudinaryConfig() {
  return {
    cloudName: requireEnv("CLOUDINARY_CLOUD_NAME"),
    apiKey: requireEnv("CLOUDINARY_API_KEY"),
    apiSecret: requireEnv("CLOUDINARY_API_SECRET"),
  };
}

/**
 * A configured-OFF capability answers 503 with a message a customer can act on — the
 * restaurant-platform-staff convention (`requirePrivateAssets`) — never a bare 500. The missing
 * variable's NAME goes to the server log; the response never carries configuration details.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[uploads] ${name} is not set — refusing an upload that needs Cloudinary.`);
    throw new ServiceUnavailableError("This store cannot accept file uploads right now. Please try again later or contact the store.");
  }
  return value;
}

/** Public, permanent assets — catalog/brand/category imagery. */
export function assetProvider(): AssetProvider {
  return (cachedAssetProvider ??= createCloudinaryProvider(cloudinaryConfig()));
}

/** Private assets with per-request signed retrieval — payment proofs. */
export function privateAssets(): ReturnType<typeof createCloudinaryPrivateAssets> {
  return (cachedPrivateAssets ??= createCloudinaryPrivateAssets(cloudinaryConfig()));
}
