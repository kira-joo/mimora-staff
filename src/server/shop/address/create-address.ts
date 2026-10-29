import mongoose from "mongoose";
import { AddressModel } from "../../core/address.schema";
import { addressRepository } from "../../core/repositories";
import type { AddressView } from "./list-addresses";

export interface CreateAddressInput {
  label: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  governorate: string;
  postalCode?: string;
  isDefault?: boolean;
}

/**
 * Creates a new address for the authenticated customer.
 *
 * **First address auto-default:** When the customer has zero addresses,
 * the first one becomes `isDefault: true` regardless of the request value.
 *
 * **Setting a new default:** When `isDefault: true` is requested and the
 * customer already has a default address, this clears the old default and
 * sets the new one atomically.
 */
export async function createAddress(customerId: string, input: CreateAddressInput): Promise<AddressView> {
  const existingCount = await addressRepository.count({ where: { customerId } });

  // First address is always default
  const isDefault = existingCount === 0 ? true : input.isDefault ?? false;

  // If setting as default and customer has other addresses, clear the old default
  if (isDefault && existingCount > 0) {
    // Direct Model use: the repository has no `updateMany`.
    await AddressModel.updateMany({ customerId, isDefault: true }, { $set: { isDefault: false } });
  }

  const created = await addressRepository.save({
    customerId,
    label: input.label,
    recipientName: input.recipientName,
    phone: input.phone,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    governorate: input.governorate,
    postalCode: input.postalCode,
    isDefault,
  });


  return {
    _id: created._id.toString(),
    customerId: created.customerId.toString(),
    label: created.label,
    recipientName: created.recipientName,
    phone: created.phone,
    addressLine1: created.addressLine1,
    addressLine2: created.addressLine2,
    city: created.city,
    governorate: created.governorate,
    postalCode: created.postalCode,
    isDefault: created.isDefault,
    createdAt: (created as any).createdAt,
    updatedAt: (created as any).updatedAt,
  };
}
