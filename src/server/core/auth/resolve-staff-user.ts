import type { AuthUser } from "@kira-joo/backend-toolkit-core";
import { buildRolePopulateRelations, resolveUserRoles } from "@kira-joo/backend-toolkit-mongoose";
import { staffUserRepository } from "../repositories";

/**
 * Resolves the authenticated staff user for a request, given the JWT's
 * `sub` claim — passed to `configureNextBackendToolkit({ auth: { resolveUser } })`.
 *
 * A fresh database read on every request, not a claim trusted from the
 * token: the JWT carries only `sub`/`tokenVersion`, so deactivating a staff
 * account or changing their role takes effect on the very next request
 * rather than waiting for the access token to expire.
 */
export async function resolveStaffUser(userId: string): Promise<AuthUser | null> {
  const user = await staffUserRepository.findOne({
    where: { _id: userId },
    relations: buildRolePopulateRelations("roles"),
    skipThrowError: true,
  });

  if (!user || !user.active) return null;

  return {
    _id: String(user._id),
    tokenVersion: user.tokenVersion,
    roles: resolveUserRoles(user.roles as unknown as Parameters<typeof resolveUserRoles>[0]),
    name: user.name,
    email: user.email,
  };
}
