import { createHash } from "node:crypto";
import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { parseMultipartFormData, validateUploadedFile } from "@kira-joo/backend-toolkit-next";
import { createPostRoute } from "src/server/core/route-factories";
import { OrderNumberParamsDto } from "src/server/shop/dto/order-number-params.dto";
import { resolveOrderAccess } from "src/server/shop/order/order-access";
import { submitPaymentProof } from "src/server/shop/order/submit-payment-proof";
import { PAYMENT_PROOF_UPLOAD_POLICY } from "src/server/core/assets/upload-policies";
import { RATE_LIMITS, enforceRateLimit } from "src/server/core/rate-limit/enforce-rate-limit";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "src/server/core/idempotency/scoped-idempotency";
import type { PaymentProofSubmissionView } from "src/server/shop/order/order.types";

const ROUTE = "POST /api/shop/orders/[orderNumber]/payment-proof";

/** The multipart field name a client submits the receipt image under. */
const FILE_FIELD = "proof";

/**
 * POST /api/shop/orders/[orderNumber]/payment-proof — customer submits
 * payment proof for a transfer order.
 *
 * `resolveOrderAccess`: the owning customer's session, or a guest's
 * `x-order-access-token` (a guest order's idempotency/rate-limit actor is
 * `order:<orderId>`). Multipart, not JSON — no `body` DTO is declared
 * (the toolkit's own "on-submit" upload convention: that skips the JSON
 * body parser so `parseMultipartFormData` can read the raw request), and
 * ownership/eligibility/payment-method validation all live in the service.
 *
 * **Idempotency uses a content hash, not file metadata alone** — two
 * different files can share a filename/mime-type/size, and metadata alone
 * would let a genuinely different resubmission silently replay the first
 * file's result. `hashRequest` (inside `claimIdempotentMutation`) only ever
 * persists the resulting short digest, never the object passed to it, so
 * folding a SHA-256 of the file's bytes into that object gives a real
 * content fingerprint without ever storing the raw file in the idempotency
 * record.
 *
 * Always POST, never PUT — every submission is a new `PaymentProof` row
 * (history), not an update of an existing one.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 201,
  params: OrderNumberParamsDto,
  handler: async ({ request, params }) => {
    const { order, owner } = await resolveOrderAccess(request, params.orderNumber);
    const actorId = owner.customer ? owner.customer._id : `order:${order._id.toString()}`;

    await enforceRateLimit({ key: `PAYMENT_PROOF_SUBMISSION:${actorId}`, ...RATE_LIMITS.PAYMENT_PROOF_SUBMISSION });

    const { files } = await parseMultipartFormData(request);
    const file = files[FILE_FIELD];
    if (!file) {
      throw new BadRequestError(`This route requires a "${FILE_FIELD}" file field.`);
    }
    validateUploadedFile(file, PAYMENT_PROOF_UPLOAD_POLICY);

    const contentHash = createHash("sha256").update(file.buffer).digest("hex");
    const fingerprint = { contentHash, filename: file.filename, mimeType: file.mimeType, size: file.size };

    const claim = await claimIdempotentMutation({ route: ROUTE, actorId, request, body: fingerprint });
    if (!claim.claimed) return claim.cachedResponse!.body as PaymentProofSubmissionView;

    try {
      const result = await submitPaymentProof({
        ...owner,
        orderNumber: params.orderNumber,
        file,
        now: new Date(),
      });

      await completeIdempotentMutation(claim, { status: 201, body: result });
      return result;
    } catch (error) {
      await releaseIdempotentMutation(claim);
      throw error;
    }
  },
});

export const dynamic = "force-dynamic";
