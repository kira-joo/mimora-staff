import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

export interface LocalizedText {
  ar: string;
  en: string;
}

export interface Brand {
  _id: string;
  name: LocalizedText;
  slug: string;
  description: LocalizedText;
  published: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface BrandInput {
  name: LocalizedText;
  slug: string;
  description: LocalizedText;
  published: boolean;
}

export interface ListBrandsQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  published?: boolean;
  /** Satisfies `Endpoint`'s `Record<string, unknown>` query constraint while keeping the named fields above. */
  [key: string]: unknown;
}

const BRANDS = "/admin/brands";

export const listBrandsEndpoint: Endpoint<{ query: ListBrandsQuery; returnType: PaginatedResponse<Brand> }> = {
  url: BRANDS,
  methodType: MethodType.GET,
};

export const getBrandEndpoint: Endpoint<{ params: { id: string }; returnType: Brand }> = {
  url: `${BRANDS}/:id`,
  methodType: MethodType.GET,
};

export const createBrandEndpoint: Endpoint<{ body: BrandInput; returnType: Brand }> = {
  url: BRANDS,
  methodType: MethodType.POST,
};

export const updateBrandEndpoint: Endpoint<{ params: { id: string }; body: Partial<BrandInput>; returnType: Brand }> = {
  url: `${BRANDS}/:id`,
  methodType: MethodType.PUT,
};

/** The API's DELETE unpublishes — it hides the brand from the storefront and keeps the record. */
export const unpublishBrandEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = {
  url: `${BRANDS}/:id`,
  methodType: MethodType.DELETE,
};
