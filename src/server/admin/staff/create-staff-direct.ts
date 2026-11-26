import { ConflictError, DuplicateKeyError, type AuthUser } from "@kira-joo/backend-toolkit-core";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import mongoose from "mongoose";
import { staffUserRepository } from "../../core/repositories";
import { assertCanAssignRoles, loadActorAccess, type RequestActor } from "../roles/role-access";
import { AppPermission } from "../../../common/authorization/authorization-registry";
import { withOwnerGuard } from "./owner-invariant";
import type { CreateStaffDirectDto } from "../dto/create-staff-direct.dto";

const EMAIL_TAKEN = "A staff member with this email already exists.";

/**
 * Creates an active staff account with a password the administrator chose — the alternative to an invitation, which
 * stays unchanged (`invite-staff.ts`). Both use the same account, role and grant rules: the roles given must be ones
 * the creator could grant (`assertCanAssignRoles`).
 *
 * The password is hashed with the same toolkit scrypt hashing login and invitation acceptance use; the plaintext is
 * never stored, logged or returned. By default `mustChangePassword` is set, which leaves the account able to do
 * nothing but change its password until it has (see `resolveStaffUser`) — the administrator who chose it should not
 * keep knowing a working credential for someone else's account.
 */
export async function createStaffDirect(dto: CreateStaffDirectDto, actor: RequestActor) {
  const email = dto.email.toLowerCase().trim();
  if (await staffUserRepository.findOne({ where: { email }, select: { _id: true }, skipThrowError: true })) {
    throw new ConflictError(EMAIL_TAKEN);
  }

  const passwordHash = await hashPassword(dto.password);
  const mustChangePassword = dto.mustChangePassword ?? true;

  try {
    // Checked and written in one serialised transaction with every role edit/delete (see `invite-staff.ts`).
    const created = await withOwnerGuard(async () => {
      await assertCanAssignRoles(await loadActorAccess(actor, AppPermission.STAFF_USER.CREATE), dto.roleIds ?? []);
      return staffUserRepository.save({
        name: dto.name.trim(),
        email,
        roles: (dto.roleIds ?? []).map((id) => new mongoose.Types.ObjectId(id)),
        passwordHash,
        ...(mustChangePassword ? { mustChangePassword: true } : {}),
      });
    });
    // Re-read: populates `roles`, and `passwordHash` (select: false) is not part of what comes back.
    return staffUserRepository.findOne({ where: { _id: created._id }, relations: ["roles"] });
  } catch (error) {
    if (error instanceof DuplicateKeyError) throw new ConflictError(EMAIL_TAKEN);
    throw error;
  }
}
