import { createGetRoute, createPutRoute } from "../../../../server/core/route-factories";
import { UpdateNotificationSettingsDto } from "../../../../server/admin/dto/update-notification-settings.dto";
import { getSingletonSettings, upsertSingletonSettings } from "../../../../server/admin/settings/singleton-settings";
import { notificationSettingsRepository } from "../../../../server/core/repositories";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.NOTIFICATION_SETTINGS.READ] },
  handler: async () => {
    const settings = await getSingletonSettings(notificationSettingsRepository);
    return settings;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.NOTIFICATION_SETTINGS.UPDATE] },
  body: UpdateNotificationSettingsDto,
  handler: async ({ body }) => {
    const settings = await upsertSingletonSettings(notificationSettingsRepository, { events: body.events });
    return settings;
  },
});
