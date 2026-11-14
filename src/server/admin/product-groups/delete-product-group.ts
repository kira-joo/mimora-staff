import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { resolveSession, trackWrite, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { ProductModel } from "../../catalog/product.schema";
import { ProductGroupModel } from "../../catalog/product-group.schema";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";

/**
 * Deletes a group and ungroups its members, in one transaction. The products themselves are kept exactly as they
 * are — only their `group` field is removed — and each goes back to being an ordinary product.
 */
export async function deleteProductGroup(groupId: string): Promise<{ ungrouped: number }> {
  const groupObjectId = new mongoose.Types.ObjectId(groupId);
  return withTransaction(
    async (tx) => {
      await backOffBeforeRetry(tx.attempt);
      const session = resolveSession();
      const deleted = await trackWrite(() => ProductGroupModel.deleteOne({ _id: groupObjectId }, { session }).exec());
      if (deleted.deletedCount === 0) throw new NotFoundError("Product group not found");
      const ungrouped = await trackWrite(() =>
        ProductModel.updateMany({ "group.groupId": groupObjectId }, { $unset: { group: "" } }, { session, timestamps: false }).exec()
      );
      return tx.complete({ ungrouped: ungrouped.modifiedCount });
    },
    { maxRetries: CONTENDED_MAX_RETRIES }
  );
}
