import { BadRequestError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { resolveSession, trackWrite, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { ProductModel } from "../../catalog/product.schema";
import { contentsProblems, type ContentItemInput } from "../../catalog/product-contents-rules";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import { readProductContents, type ProductContentsView } from "./product-contents-views";

/**
 * Makes `items` — in this order, with these quantities — the product's whole contents list, in one transaction. The
 * box must exist and so must every included product (of ANY lifecycle: staff may prepare a box before its items are
 * published); otherwise nothing is written. Only `contents` changes on the box, and not its `updatedAt`, so an open
 * product form is not reset. Nothing about an included product changes at all.
 */
export async function setProductContents(productId: string, items: ContentItemInput[]): Promise<ProductContentsView> {
  const problems = contentsProblems(productId, items);
  if (problems.length > 0) throw new BadRequestError(problems.join(" "));
  const boxId = new mongoose.Types.ObjectId(productId);
  const contents = items.map((item) => ({ productId: new mongoose.Types.ObjectId(item.productId.trim()), quantity: item.quantity }));

  return withTransaction(
    async (tx) => {
      await backOffBeforeRetry(tx.attempt);
      const session = resolveSession();

      if (!(await ProductModel.exists({ _id: boxId }).session(session ?? null))) throw new NotFoundError("Product not found");

      if (contents.length > 0) {
        const found = await ProductModel.find({ _id: { $in: contents.map((entry) => entry.productId) } }, { _id: 1 }, { session }).lean();
        if (found.length !== contents.length) {
          const missing = contents.length - found.length;
          throw new NotFoundError(`${missing} of the included products ${missing === 1 ? "does" : "do"} not exist. Reload and try again.`);
        }
      }

      await trackWrite(() =>
        (contents.length > 0
          ? ProductModel.updateOne({ _id: boxId }, { $set: { contents } }, { session, timestamps: false })
          : ProductModel.updateOne({ _id: boxId }, { $unset: { contents: "" } }, { session, timestamps: false })
        ).exec()
      );

      return tx.complete(await readProductContents(productId));
    },
    { maxRetries: CONTENDED_MAX_RETRIES }
  );
}
