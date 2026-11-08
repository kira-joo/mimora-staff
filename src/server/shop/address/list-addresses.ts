import { AddressModel } from "../../core/address.schema";
import { addressRepository } from "../../core/repositories";
import type { WithTimestamps } from "../../core/with-timestamps";

export interface AddressView {
  _id: string;
  customerId: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  governorate: string;
  postalCode?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListAddressesResult {
  addresses: AddressView[];
  total: number;
}

/**
 * Lists the authenticated customer's addresses.
 *
 * Returns only addresses owned by the customer. Pagination supported.
 */
export async function listAddresses(
  customerId: string,
  options: { limit: number; skip: number }
): Promise<ListAddressesResult> {
  const [addresses, total] = await Promise.all([
    // Direct Model use: the repository's `sort` is single-field; this list needs `isDefault` then `createdAt`.
    AddressModel.find({ customerId })
      .sort({ isDefault: -1, createdAt: -1 })
      .limit(options.limit)
      .skip(options.skip)
      .lean(),
    addressRepository.count({ where: { customerId } }),
  ]);

  return {
    addresses: addresses.map((addr) => ({
      _id: addr._id.toString(),
      customerId: addr.customerId.toString(),
      label: addr.label,
      recipientName: addr.recipientName,
      phone: addr.phone,
      addressLine1: addr.addressLine1,
      addressLine2: addr.addressLine2,
      city: addr.city,
      governorate: addr.governorate,
      postalCode: addr.postalCode,
      isDefault: addr.isDefault,
      createdAt: (addr as WithTimestamps<typeof addr>).createdAt,
      updatedAt: (addr as WithTimestamps<typeof addr>).updatedAt,
    })),
    total,
  };
}
