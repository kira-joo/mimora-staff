import { createPostRoute } from "src/server/core/route-factories";
import { resolveShopActor } from "src/server/shop/shop-actor";
import { generateQuote } from "src/server/shop/quote/generate-quote";
import { QuoteQueryDto } from "src/server/shop/dto/quote-query.dto";

export const dynamic = "force-dynamic";

export const POST = createPostRoute({
  auth: false,
  query: QuoteQueryDto,
  async handler({ request, query }) {
    const actor = await resolveShopActor(request);

    // Extract locale from Accept-Language header or default to "en"
    const acceptLanguage = request.headers.get("accept-language")?.split(",")[0]?.split("-")[0];
    const locale: "en" | "ar" = acceptLanguage === "ar" ? "ar" : "en";

    return generateQuote({ actor, locale, now: new Date(), ...(query.delivery ? { deliveryPreview: { governorate: query.governorate?.trim() ?? "" } } : {}) });
  },
});
