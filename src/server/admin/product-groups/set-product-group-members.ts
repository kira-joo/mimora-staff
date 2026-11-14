import { BadRequestError, ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { resolveSession, trackWrite, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { ProductModel } from "../../catalog/product.schema";
import { ProductGroupModel } from "../../catalog/product-group.schema";
import { membershipProblems, normalizeMembers, type GroupMemberInput } from "../../catalog/product-group-rules";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import { readProductGroupDetail, type ProductGroupDetail } from "./product-group-views";

export const STALE_GROUP_MESSAGE = "This group was changed by someone else since you opened it. Reload it, then make your change again.";

/**
 * Makes `members` — in this order, with these labels — the group's whole membership, in one transaction:
 * - a product listed here joins (or stays in) the group at its position; one that was in ANOTHER group moves here;
 * - a product in this group that is not listed leaves it (its record is otherwise untouched);
 * - nothing else about any product changes — no price, stock, image, variant, lifecycle or category, and not its
 *   `updatedAt`, so an open product form is not reset by a membership change.
 *
 * `expectedRevision` is the group's revision the caller loaded. The group is written first, conditional on it, so a
 * save built from a stale read is a 409 (never a silent overwrite), and so this write and a concurrent delete or
 * membership change of the same group conflict at the database. A group a moved product LEAVES is written too — its
 * revision changes, and its own editor is refused rather than putting the product back.
 */
export async function setProductGroupMembers(groupId: string, input: { expectedRevision: number; members: GroupMemberInput[] }): Promise<ProductGroupDetail> {
  const problems = membershipProblems(input.members);
  if (problems.length > 0) throw new BadRequestError(problems.join(" "));
  const members = normalizeMembers(input.members);
  if (!members.every((member) => mongoose.isValidObjectId(member.productId))) throw new BadRequestError("A product id is not valid.");
  const groupObjectId = new mongoose.Types.ObjectId(groupId);

  return withTransaction(
    async (tx) => {
      await backOffBeforeRetry(tx.attempt);
      const session = resolveSession();

      const claimed = await trackWrite(() =>
        ProductGroupModel.updateOne({ _id: groupObjectId, revision: input.expectedRevision }, { $inc: { revision: 1 } }, { session }).exec()
      );
      if (claimed.matchedCount === 0) {
        const exists = await ProductGroupModel.exists({ _id: groupObjectId }).session(session ?? null);
        throw exists ? new ConflictError(STALE_GROUP_MESSAGE) : new NotFoundError("Product group not found");
      }

      const ids = members.map((member) => new mongoose.Types.ObjectId(member.productId));
      const found = await ProductModel.find({ _id: { $in: ids } }, { group: 1 }, { session }).lean();
      if (found.length !== ids.length) {
        const known = new Set(found.map((product) => product._id.toString()));
        const missing = members.filter((member) => !known.has(member.productId)).length;
        throw new NotFoundError(`${missing} of the products no longer exist${missing === 1 ? "s" : ""}. Reload the group and try again.`);
      }

      // Groups that lose a product to this one — written in id order so concurrent movers take them alike.
      const leftGroups = [...new Set(found.map((product) => product.group?.groupId?.toString()).filter((id): id is string => Boolean(id) && id !== groupId))].sort();
      for (const left of leftGroups) {
        await trackWrite(() => ProductGroupModel.updateOne({ _id: left }, { $inc: { revision: 1 } }, { session }).exec());
      }

      await trackWrite(() =>
        ProductModel.updateMany({ "group.groupId": groupObjectId, _id: { $nin: ids } }, { $unset: { group: "" } }, { session, timestamps: false }).exec()
      );
      for (const [order, member] of members.entries()) {
        await trackWrite(() =>
          ProductModel.updateOne(
            { _id: member.productId },
            { $set: { group: { groupId: groupObjectId, label: member.label, order } } },
            { session, timestamps: false }
          ).exec()
        );
      }

      return tx.complete(await readProductGroupDetail(groupId));
    },
    { maxRetries: CONTENDED_MAX_RETRIES }
  );
}
