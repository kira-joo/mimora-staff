import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

/**
 * No extra filter fields yet — `Product` carries no `@Filterable()` fields
 * in the committed Phase 2 schema, and adding one is a schema change out of
 * proportion to this phase's first admin route. Pagination/search/sort from
 * `BaseFindQueryDto` alone is a complete, correct list endpoint; filtering
 * is added the same way any later route adds it — a `@Filterable()` field
 * on the schema plus a matching DTO property.
 */
export class ListProductsQueryDto extends BaseFindQueryDto {}
