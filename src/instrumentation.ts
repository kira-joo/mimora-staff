/*
 * `reflect-metadata` is a global polyfill: it mutates the ambient `Reflect`
 * object, so class-validator/class-transformer decorators only work once
 * SOMETHING in the process has imported it. Importing it here — in the one
 * module Next guarantees runs before the server accepts a request — removes
 * any dependence on incidental import ordering. `route-factories.ts` imports
 * it again defensively; see that module's comment for why one import site
 * is not trusted under Turbopack.
 */
import "reflect-metadata";

/**
 * Runs once per server instance at boot: configures the toolkit, connects
 * the database, and syncs the permission registry.
 *
 * Everything is imported dynamically INSIDE the function rather than at
 * module scope. `instrumentation.ts` is evaluated in every runtime Next
 * builds for, including the edge one, and a top-level `mongoose` import
 * would be traced into a bundle that cannot run it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Fail fast, before anything connects or listens: in production a missing or unusable REQUIRED variable stops the
  // process with a message naming it (never its value). `next build` is exempt — the build host need not carry runtime
  // secrets. Capability variables that are set but unusable are announced here; absent ones are announced below.
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { assertProductionEnvironment } = await import("./server/core/config/env-validation");
    for (const notice of assertProductionEnvironment(process.env, process.env.NODE_ENV)) {
      (notice.level === "error" && process.env.NODE_ENV === "production" ? console.error : console.warn)(notice.message);
    }
  }

  const { configureToolkit } = await import("./server/core/toolkit.config");
  configureToolkit();

  const { revalidationConfigStatus } = await import("./server/core/revalidation/publish-revalidation");
  const revalidation = revalidationConfigStatus(process.env);
  if (revalidation.state !== "configured") {
    // A capability configured OFF must be loud at startup, in production above all.
    const log = process.env.NODE_ENV === "production" ? console.error : console.warn;
    log(`[revalidation] ${revalidation.message}`);
  }

  // Outbound email: configured, OFF, or half-configured — said once, here, never lazily on a first import.
  const { mailConfigStatus, announceMailStatus } = await import("./server/core/mail/mail-config");
  announceMailStatus(mailConfigStatus(process.env), process.env.NODE_ENV);

  const { storeTimeZone } = await import("./server/core/config/store-timezone");
  console.log(`[config] store time zone: ${storeTimeZone()}`);

  // Receipt uploads (bank transfer / InstaPay / wallet) need private file storage; without it the
  // first customer to pay by transfer hits the failure. Configured OFF must be loud at boot.
  const { missingCloudinaryVariables } = await import("./server/core/assets/asset-providers");
  const missingStorage = missingCloudinaryVariables(process.env);
  if (missingStorage.length > 0) {
    const log = process.env.NODE_ENV === "production" ? console.error : console.warn;
    log(`[uploads] ${missingStorage.join(", ")} not set — receipt uploads (every transfer-type payment) and catalog image uploads will FAIL until they are.`);
  }

  const { storePhoneCountryCode } = await import("./server/core/config/store-phone-country");
  const phoneCountryCode = storePhoneCountryCode();
  if (phoneCountryCode) {
    console.log(`[config] customer phone default country code: +${phoneCountryCode}`);
  } else {
    // Configured OFF: national numbers (01012345678) are not converted to E.164 and may split one person across two accounts.
    const log = process.env.NODE_ENV === "production" ? console.error : console.warn;
    log("[phone] STORE_PHONE_COUNTRY_CODE is not set — national phone numbers are kept as typed (no +<cc> conversion).");
  }

  const { connectToDatabase } = await import("./server/core/db/connect");
  await connectToDatabase();

  // The phone country must be the store's own: cross-check it against the merchant's contact number.
  const { phoneCountryMismatch } = await import("./server/core/config/store-phone-country");
  const { StoreProfileModel } = await import("./server/content/store-profile.schema");
  const profile = await StoreProfileModel.findOne({}, { "contact.phone": 1 }).lean();
  const phoneProblem = phoneCountryMismatch(storePhoneCountryCode(), profile?.contact?.phone);
  if (phoneProblem) (process.env.NODE_ENV === "production" ? console.error : console.warn)(`[phone] ${phoneProblem}`);

  // One read, and a write only for a missing or drifted permission (see reconcile-permissions.ts) — not one per permission.
  const { reconcilePermissions } = await import("./server/core/authorization/reconcile-permissions");
  const { PermissionModel } = await import("./server/core/authorization/role.model");
  const { ALL_PERMISSION_DEFINITIONS } = await import("./common/authorization/authorization-registry");

  const result = await reconcilePermissions({
    model: PermissionModel,
    definitions: ALL_PERMISSION_DEFINITIONS,
  });

  console.log(`[permissions] synced: ${result.created.length} created, ${result.updated.length} updated, ${result.skipped.length} already existed`);

  const { seedDefaultRoles } = await import("./server/admin/staff/seed-default-roles");
  const roleResult = await seedDefaultRoles();

  console.log(`[roles] seeded: ${roleResult.created.length} created, ${roleResult.skipped.length} already existed`);
  for (const [role, keys] of Object.entries(roleResult.permissionsAdded)) console.log(`[roles] ${role}: added missing default permissions (${keys.join(", ")})`);
}
