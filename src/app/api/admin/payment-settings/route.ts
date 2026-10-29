import { createGetRoute, createPutRoute } from "../../../../server/core/route-factories";
import { UpdatePaymentSettingsDto } from "../../../../server/admin/dto/update-payment-settings.dto";
import { getSingletonSettings, upsertSingletonSettings } from "../../../../server/admin/settings/singleton-settings";
import { paymentSettingsRepository } from "../../../../server/core/repositories";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PAYMENT_SETTINGS.READ] },
  handler: async () => {
    const settings = await getSingletonSettings(paymentSettingsRepository);
    return settings;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PAYMENT_SETTINGS.UPDATE] },
  body: UpdatePaymentSettingsDto,
  revalidateTags: ["PAYMENT_SETTINGS"],
  handler: async ({ body }) => {
    const settings = await upsertSingletonSettings(paymentSettingsRepository, { methods: body.methods });
    return settings;
  },
});
