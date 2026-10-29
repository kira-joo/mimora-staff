import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { LocalizedText } from "./brands.endpoints";

/**
 * The chart's stored shape. The schema keeps `chartData` as free-form JSON;
 * this is the shape the storefront content API is tested with
 * (`get-content.integration.test.ts`), so it is the one the editor writes.
 */
export interface SizeChart {
  headers: string[];
  rows: string[][];
}

export interface SizeGuide {
  _id: string;
  name: LocalizedText;
  description: LocalizedText;
  chartData: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SizeGuideInput {
  name: LocalizedText;
  description: LocalizedText;
  chartData: SizeChart;
}

export interface ListSizeGuidesQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  [key: string]: unknown;
}

const SIZE_GUIDES = "/admin/size-guides";

export const listSizeGuidesEndpoint: Endpoint<{ query: ListSizeGuidesQuery; returnType: PaginatedResponse<SizeGuide> }> = {
  url: SIZE_GUIDES,
  methodType: MethodType.GET,
};

export const getSizeGuideEndpoint: Endpoint<{ params: { id: string }; returnType: SizeGuide }> = {
  url: `${SIZE_GUIDES}/:id`,
  methodType: MethodType.GET,
};

export const createSizeGuideEndpoint: Endpoint<{ body: SizeGuideInput; returnType: SizeGuide }> = {
  url: SIZE_GUIDES,
  methodType: MethodType.POST,
};

export const updateSizeGuideEndpoint: Endpoint<{ params: { id: string }; body: Partial<SizeGuideInput>; returnType: SizeGuide }> = {
  url: `${SIZE_GUIDES}/:id`,
  methodType: MethodType.PUT,
};

/** A real delete — size guides have no published state. */
export const deleteSizeGuideEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = {
  url: `${SIZE_GUIDES}/:id`,
  methodType: MethodType.DELETE,
};
