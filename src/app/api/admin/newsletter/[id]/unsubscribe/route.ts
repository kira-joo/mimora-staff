import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { adminUnsubscribe } from "../../../../../../server/newsletter/admin-unsubscribe";
import { AppPermission } from "../../../../../../common/authorization/authorization-registry";

export const dynamic = "force-dynamic";

/** Unsubscribes an address on staff's behalf. Audited by the factory (entity `NewsletterSubscriber`, action `update`, the row's id). */
export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.NEWSLETTER_SUBSCRIBER.UPDATE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => adminUnsubscribe(params.id),
});
