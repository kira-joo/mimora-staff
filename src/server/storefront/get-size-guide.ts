import { sizeGuideRepository } from "../core/repositories";
import type { SizeGuideSchema } from "../catalog/size-guide.schema";

/** `findOne` throws `NotFoundError` itself when nothing matches — no wrapping needed here. Validating `id` is a real Mongo id is the route's own params DTO's job, not this function's. */
export async function getSizeGuide(id: string): Promise<SizeGuideSchema> {
  return sizeGuideRepository.findOne({ where: { _id: id } });
}
