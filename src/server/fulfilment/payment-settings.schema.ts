import { MongoField, MongoSchema, localizedStringSchema, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * PaymentSettings — the merchant's configured payment methods.
 *
 * New in Phase 4A.5 (MDS §8.1 defines it; it did not exist at all before).
 * `methods[].method` is a free-form key, not a fixed enum — this is the
 * mechanism the architecture review's payment design relies on: adding a
 * new method (or, later, a real online-payment provider) is a new entry
 * here plus a webhook route, never a change to `Order.payment.method`'s
 * type or to the order-placement/state-machine engines, both of which
 * consume `method` as a plain string.
 *
 * `requiresProviderIntegration` is the extension point named in the
 * architecture review: `false` for every method today (COD needs no proof
 * and no provider; bank-transfer/wallet methods need a proof, not a
 * provider). A future "Online Payment" method sets this `true`, which is
 * what routes it toward a provider callback instead of manual staff
 * verification — no schema or `Order.payment` shape change needed when
 * that day comes.
 *
 * Singleton per deployment, same convention as `StoreProfile`.
 */
@MongoSchema({ timestamps: true })
export class PaymentSettingsSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField({
    type: [
      new mongoose.Schema(
        {
          method: { type: String, required: true },
          enabled: { type: Boolean, default: true },
          order: { type: Number, default: 0 },
          instructions: { type: localizedStringSchema(), required: false },
          destination: {
            type: new mongoose.Schema(
              {
                accountName: { type: String, required: false },
                number: { type: String, required: false },
                handle: { type: String, required: false },
              },
              { _id: false }
            ),
            required: false,
          },
          requiresProof: { type: Boolean, default: false },
          requiresProviderIntegration: { type: Boolean, default: false },
          autoCancelMinutes: { type: Number, required: false },
          verificationWindowMinutes: { type: Number, required: false },
        },
        { _id: false }
      ),
    ],
    default: () => [],
  })
  methods!: Array<{
    method: string;
    enabled: boolean;
    order: number;
    instructions?: LocalizedString;
    destination?: { accountName?: string; number?: string; handle?: string };
    requiresProof: boolean;
    requiresProviderIntegration: boolean;
    autoCancelMinutes?: number;
    verificationWindowMinutes?: number;
  }>;
}

export const PaymentSettingsModel = createMongoModel("PaymentSettings", PaymentSettingsSchema);
