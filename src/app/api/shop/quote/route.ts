import { createPostRoute } from "src/server/core/route-factories";
import { resolveShopActor } from "src/server/shop/shop-actor";
import { generateQuote } from "src/server/shop/quote/generate-quote";

export const dynamic = "force-dynamic";

export const POST = createPostRoute({
  auth: false,
  async handler({ request }) {
    const actor = await resolveShopActor(request);

    // Extract locale from Accept-Language header or default to "en"
    const acceptLanguage = request.headers.get("accept-language")?.split(",")[0]?.split("-")[0];
    const locale: "en" | "ar" = acceptLanguage === "ar" ? "ar" : "en";

    return generateQuote({ actor, locale, now: new Date() });
  },
});
