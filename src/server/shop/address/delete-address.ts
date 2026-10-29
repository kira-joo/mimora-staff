import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { addressRepository } from "../../core/repositories";

/**
 * Deletes an address.
 *
 * **Ownership check:** The address must belong to the authenticated customer.
 * Returns 404 for non-existent addresses AND for addresses owned by other customers.
 *
 * Hard delete — no soft-delete flag. Addresses are simple reference data.
 */
export async function deleteAddress(customerId: string, addressId: string): Promise<void> {
  const deleted = await addressRepository.delete({ where: { _id: addressId, customerId }, skipThrowError: true });

  if (!deleted) {
    throw new NotFoundError("Address not found");
  }
}
