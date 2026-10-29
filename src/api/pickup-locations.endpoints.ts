import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { LocalizedText } from "src/api/brands.endpoints";

export interface PickupLocation {
  _id: string;
  name: LocalizedText;
  address: LocalizedText;
  coordinates?: { lat: number; lng: number };
  phone: string;
  active: boolean;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PickupLocationInput {
  name: LocalizedText;
  address: LocalizedText;
  /** On an update, `null` removes stored coordinates. */
  coordinates?: { lat: number; lng: number } | null;
  phone: string;
  active?: boolean;
}

export interface ListPickupLocationsQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  active?: boolean;
  /** Satisfies `Endpoint`'s `Record<string, unknown>` query constraint while keeping the named fields above. */
  [key: string]: unknown;
}

export interface ReorderPickupLocationsBody {
  items: Array<{ locationId: string; order: number }>;
}

const LOCATIONS = "/admin/pickup-locations";

export const listPickupLocationsEndpoint: Endpoint<{ query: ListPickupLocationsQuery; returnType: PaginatedResponse<PickupLocation> }> = {
  url: LOCATIONS,
  methodType: MethodType.GET,
};

export const getPickupLocationEndpoint: Endpoint<{ params: { id: string }; returnType: PickupLocation }> = {
  url: `${LOCATIONS}/:id`,
  methodType: MethodType.GET,
};

export const createPickupLocationEndpoint: Endpoint<{ body: PickupLocationInput; returnType: PickupLocation }> = {
  url: LOCATIONS,
  methodType: MethodType.POST,
};

export const updatePickupLocationEndpoint: Endpoint<{ params: { id: string }; body: Partial<PickupLocationInput>; returnType: PickupLocation }> = {
  url: `${LOCATIONS}/:id`,
  methodType: MethodType.PUT,
};

/** The API's DELETE deactivates (`active: false`) — the location leaves checkout and the record stays. */
export const deactivatePickupLocationEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = {
  url: `${LOCATIONS}/:id`,
  methodType: MethodType.DELETE,
};

export const reorderPickupLocationsEndpoint: Endpoint<{ body: ReorderPickupLocationsBody; returnType: void }> = {
  url: `${LOCATIONS}/reorder`,
  methodType: MethodType.PUT,
};
