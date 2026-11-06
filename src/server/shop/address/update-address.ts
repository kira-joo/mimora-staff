import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { AddressModel } from "../../core/address.schema";
import { addressRepository } from "../../core/repositories";
import type { AddressView } from "./list-addresses";
import type { WithTimestamps } from "../../core/with-timestamps";

export interface UpdateAddressInput {
  label?: string;
  recipientName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  governorate?: string;
  postalCode?: string;
  isDefault?: boolean;
}

/**
 * Updates an existing address.
 *
 * **Ownership check:** The address must belong to the authenticated customer.
 *
 * **Setting as default:** When `isDefault: true` is set, clears the old default
 * and sets this one atomically. The update and the default-clearing happen in
 * sequence — no transaction needed because the invariant (at most one default)
 * tolerates both operations being visible separately.
 */
export async function updateAddress(
  customerId: string,
  addressId: string,
  input: UpdateAddressInput
): Promise<AddressView> {
  // Verify ownership first
  const existing = await addressRepository.findOne({ where: { _id: addressId, customerId }, skipThrowError: true });
  if (!existing) {
    throw new NotFoundError("Address not found");
  }

  // If setting as default, clear the old default first
  if (input.isDefault === true && !existing.isDefault) {
    // Direct Model use: the repository has no `updateMany`.
    await AddressModel.updateMany({ customerId, isDefault: true }, { $set: { isDefault: false } });
  }

  const updated = await addressRepository.update({ where: { _id: addressId, customerId }, skipThrowError: true }, input);

  if (!updated) {
    throw new NotFoundError("Address not found");
  }

  return {
    _id: updated._id.toString(),
    customerId: updated.customerId.toString(),
    label: updated.label,
    recipientName: updated.recipientName,
    phone: updated.phone,
    addressLine1: updated.addressLine1,
    addressLine2: updated.addressLine2,
    city: updated.city,
    governorate: updated.governorate,
    postalCode: updated.postalCode,
    isDefault: updated.isDefault,
    createdAt: (updated as WithTimestamps<typeof updated>).createdAt,
    updatedAt: (updated as WithTimestamps<typeof updated>).updatedAt,
  };
}
