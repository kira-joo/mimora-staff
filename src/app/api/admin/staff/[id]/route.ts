import { createGetRoute, createPutRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateStaffDto } from "../../../../../server/admin/dto/update-staff.dto";
import { updateStaff } from "../../../../../server/admin/staff/update-staff";
import { staffUserRepository } from "../../../../../server/core/repositories";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [CustomPermission.STAFF_MANAGE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const staff = await staffUserRepository.findOne({ where: { _id: params.id }, relations: ["roles"] });
    return staff;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.STAFF_MANAGE] },
  params: MongoIdParamsDto,
  body: UpdateStaffDto,
  handler: async ({ params, body, user }) => {
    const staff = await updateStaff({ staffId: params.id, actingStaffId: user._id, body });
    return staff;
  },
});
