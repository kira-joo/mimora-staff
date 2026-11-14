import { BadRequestError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import { ProductGroupModel } from "../../catalog/product-group.schema";
import { groupNameProblem } from "../../catalog/product-group-rules";
import { readProductGroupDetail, type ProductGroupDetail } from "./product-group-views";

/**
 * Renames a group. Does not bump `revision`: the name is not membership, so renaming must not make an open
 * membership editor's save fail as stale.
 */
export async function renameProductGroup(groupId: string, input: { name: LocalizedString }): Promise<ProductGroupDetail> {
  const problem = groupNameProblem(input.name);
  if (problem) throw new BadRequestError(problem);
  const result = await ProductGroupModel.updateOne({ _id: groupId }, { $set: { name: { en: (input.name.en ?? "").trim(), ar: (input.name.ar ?? "").trim() } } }).exec();
  if (result.matchedCount === 0) throw new NotFoundError("Product group not found");
  return readProductGroupDetail(groupId);
}
