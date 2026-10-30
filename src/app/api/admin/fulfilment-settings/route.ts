import { toMoney } from "@kira-joo/toolkit-common";
import { createGetRoute, createPutRoute } from "../../../../server/core/route-factories";
import { UpdateFulfilmentSettingsDto } from "../../../../server/admin/dto/update-fulfilment-settings.dto";
import { getSingletonSettings, upsertSingletonSettings } from "../../../../server/admin/settings/singleton-settings";
import { fulfilmentSettingsRepository } from "../../../../server/core/repositories";
import { AppPermission } from "../../../../common/authorization/authorization-registry";
import { mapPresent, toUpdateOperators } from "../../../../server/core/update/optional-update";
import { ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { carrierListProblems } from "../../../../server/fulfilment/carrier-tracking";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.FULFILMENT_SETTINGS.READ] },
  handler: async () => {
    const settings = await getSingletonSettings(fulfilmentSettingsRepository);
    return settings;
  },
});

/**
 * Optional settings a merchant can remove: no order minimum, no flat fee
 * (a FLAT store then charges nothing — `resolveShipping`'s `?? ZERO`), no
 * daily cutoff, no shipping days (delivery promises count calendar days again).
 */
const CLEARABLE_FULFILMENT_SETTINGS = ["orderMinimum", "flatShippingFee", "cutoffTime", "shippingDays"] as const;

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.FULFILMENT_SETTINGS.UPDATE] },
  body: UpdateFulfilmentSettingsDto,
  revalidateTags: ["FULFILMENT_SETTINGS"],
  handler: async ({ body }) => {
    // Carriers carry the rules a DTO cannot: https-only templates containing {tracking}, and unique keys.
    const carrierProblems = body.carriers ? carrierListProblems(body.carriers) : [];
    if (carrierProblems.length > 0) throw new ValidationFailedError(carrierProblems);

    // Omitted leaves a setting as it is; null clears one of the optional ones, whose absence the engines already define.
    const { $set, $unset } = toUpdateOperators(
      {
        ...body,
        orderMinimum: mapPresent(body.orderMinimum, toMoney),
        flatShippingFee: mapPresent(body.flatShippingFee, toMoney),
      },
      CLEARABLE_FULFILMENT_SETTINGS
    );

    const settings = await upsertSingletonSettings(fulfilmentSettingsRepository, $set, $unset);
    return settings;
  },
});
