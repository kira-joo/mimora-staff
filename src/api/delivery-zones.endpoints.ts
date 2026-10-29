import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { LocalizedText } from "src/api/brands.endpoints";

/** Money is a decimal string on the wire ("10.00"), never a float. */
export interface DeliveryZone {
  _id: string;
  name: LocalizedText;
  areas: string[];
  fee: string;
  /** The zone's own minimum; absent means the store-wide minimum applies. */
  minimumOrder?: string;
  leadDays: number;
  active: boolean;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DeliveryZoneInput {
  name: LocalizedText;
  areas?: string[];
  fee: string;
  /** On an update, `null` removes the zone's own minimum. */
  minimumOrder?: string | null;
  leadDays?: number;
  active?: boolean;
}

export interface ListDeliveryZonesQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  active?: boolean;
  /** Satisfies `Endpoint`'s `Record<string, unknown>` query constraint while keeping the named fields above. */
  [key: string]: unknown;
}

export interface ReorderDeliveryZonesBody {
  items: Array<{ zoneId: string; order: number }>;
}

const ZONES = "/admin/delivery-zones";

export const listDeliveryZonesEndpoint: Endpoint<{ query: ListDeliveryZonesQuery; returnType: PaginatedResponse<DeliveryZone> }> = {
  url: ZONES,
  methodType: MethodType.GET,
};

export const getDeliveryZoneEndpoint: Endpoint<{ params: { id: string }; returnType: DeliveryZone }> = {
  url: `${ZONES}/:id`,
  methodType: MethodType.GET,
};

export const createDeliveryZoneEndpoint: Endpoint<{ body: DeliveryZoneInput; returnType: DeliveryZone }> = {
  url: ZONES,
  methodType: MethodType.POST,
};

export const updateDeliveryZoneEndpoint: Endpoint<{ params: { id: string }; body: Partial<DeliveryZoneInput>; returnType: DeliveryZone }> = {
  url: `${ZONES}/:id`,
  methodType: MethodType.PUT,
};

/** The API's DELETE soft-deletes: the zone leaves the list and checkout, and past orders keep their own snapshot. */
export const deleteDeliveryZoneEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = {
  url: `${ZONES}/:id`,
  methodType: MethodType.DELETE,
};

export const reorderDeliveryZonesEndpoint: Endpoint<{ body: ReorderDeliveryZonesBody; returnType: void }> = {
  url: `${ZONES}/reorder`,
  methodType: MethodType.PUT,
};
