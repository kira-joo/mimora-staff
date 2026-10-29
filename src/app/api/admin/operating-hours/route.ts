import { createGetRoute, createPutRoute } from "../../../../server/core/route-factories";
import { UpdateOperatingHoursDto } from "../../../../server/admin/dto/update-operating-hours.dto";
import { getSingletonSettings, upsertSingletonSettings } from "../../../../server/admin/settings/singleton-settings";
import { operatingHoursRepository } from "../../../../server/core/repositories";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.OPERATING_HOURS.READ] },
  handler: async () => {
    const hours = await getSingletonSettings(operatingHoursRepository);
    return hours;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.OPERATING_HOURS.UPDATE] },
  body: UpdateOperatingHoursDto,
  revalidateTags: ["OPERATING_HOURS"],
  handler: async ({ body }) => {
    const hours = await upsertSingletonSettings(operatingHoursRepository, {
      weekly: body.weekly,
      exceptions: body.exceptions.map((e) => ({ ...e, date: new Date(e.date) })),
    });

    return hours;
  },
});
