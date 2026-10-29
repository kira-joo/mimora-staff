import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { addressRepository } from "../../core/repositories";
import type { AddressView } from "./list-addresses";

/**
 * Fetches a single address by ID.
 *
 * **Ownership check:** The address must belong to the authenticated customer.
 * Returns 404 for non-existent addresses AND for addresses owned by other customers.
 */
export async function getAddress(customerId: string, addressId: string): Promise<AddressView> {
  const address = await addressRepository.findOne({ where: { _id: addressId, customerId }, skipThrowError: true });

  if (!address) {
    throw new NotFoundError("Address not found");
  }

  return {
    _id: address._id.toString(),
    customerId: address.customerId.toString(),
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    governorate: address.governorate,
    postalCode: address.postalCode,
    isDefault: address.isDefault,
    createdAt: (address as any).createdAt,
    updatedAt: (address as any).updatedAt,
  };
}
