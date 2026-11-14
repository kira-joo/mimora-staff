import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import { productGroupRepository } from "../../core/repositories";
import { groupNameProblem } from "../../catalog/product-group-rules";
import { readProductGroupDetail, type ProductGroupDetail } from "./product-group-views";

/** An empty group. Products join it through `setProductGroupMembers`. */
export async function createProductGroup(input: { name: LocalizedString }): Promise<ProductGroupDetail> {
  const problem = groupNameProblem(input.name);
  if (problem) throw new BadRequestError(problem);
  const created = await productGroupRepository.save({ name: { en: (input.name.en ?? "").trim(), ar: (input.name.ar ?? "").trim() }, revision: 0 });
  return readProductGroupDetail(created._id.toString());
}
