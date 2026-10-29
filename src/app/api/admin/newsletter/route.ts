import { createGetRoute } from "../../../../server/core/route-factories";
import { ListNewsletterSubscribersQueryDto, listNewsletterSubscribers } from "../../../../server/newsletter/list-subscribers";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.NEWSLETTER_SUBSCRIBER.READ] },
  query: ListNewsletterSubscribersQueryDto,
  handler: async ({ query }) => listNewsletterSubscribers(query),
});
