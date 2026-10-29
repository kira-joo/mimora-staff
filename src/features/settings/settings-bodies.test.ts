import { describe, expect, it } from "vitest";
import type { PaymentMethod, StoreProfile } from "src/api/settings.endpoints";
import {
  describePaymentChanges,
  emptyPaymentMethod,
  notificationsToForm,
  paymentToForm,
  storeProfileToForm,
  themeToForm,
  toNotificationBody,
  toPaymentMethods,
  toStoreProfileBody,
  toThemeBody,
} from "./settings-bodies";

const profile: StoreProfile = {
  _id: "1",
  name: { ar: "متجر", en: "Store" },
  tagline: { ar: "", en: "" },
  description: { ar: "", en: "" },
  currency: "EGP",
  defaultLocale: "ar",
};

describe("store profile body", () => {
  it("fills a profile that has no contact or social links yet, without inventing values", () => {
    const form = storeProfileToForm(profile);
    expect(form.contact).toEqual({ phone: "", email: "", whatsApp: "" });
    expect(form.socialLinks).toEqual([]);
    expect(form.supportedLocales).toEqual(["ar"]);
  });

  it("keeps the saved languages when there are some", () => {
    expect(storeProfileToForm({ ...profile, defaultLocale: "en", supportedLocales: ["ar", "en"] }).supportedLocales).toEqual(["ar", "en"]);
  });

  it("upper-cases the currency, trims contact, and omits a blank WhatsApp", () => {
    const form = storeProfileToForm(profile);
    form.currency = " egp ";
    form.contact = { phone: " 0100 ", email: " a@b.co ", whatsApp: "  " };
    const body = toStoreProfileBody(form);
    expect(body.currency).toBe("EGP");
    expect(body.contact).toEqual({ phone: "0100", email: "a@b.co", whatsApp: undefined });
  });

  const asset = (publicId: string) => ({ provider: "cloudinary", publicId, secureUrl: `https://x/${publicId}.png`, format: "png", width: 300, height: 300, bytes: 900 }) as never;

  it("sends the four image slots as they stand: the stored asset, or null for none — the social image is the profile's own ogImage", () => {
    const form = storeProfileToForm({ ...profile, logo: asset("logo"), ogImage: asset("og") });
    const body = toStoreProfileBody(form);
    expect(body.logo).toEqual(asset("logo"));
    expect(body.ogImage).toEqual(asset("og"));
    // Never picked: null, which removes nothing (there is nothing there) but states the slot is empty.
    expect(body.favicon).toBeNull();
    expect(body.heroMedia).toBeNull();
  });

  it("a slot cleared in the form is sent as null, so the server removes it and destroys the file", () => {
    const form = storeProfileToForm({ ...profile, logo: asset("logo") });
    form.logo = null;
    expect(toStoreProfileBody(form).logo).toBeNull();
  });

  it("reads the image slots back into the form, null when absent", () => {
    expect(storeProfileToForm(profile)).toMatchObject({ logo: null, favicon: null, ogImage: null, heroMedia: null });
    expect(storeProfileToForm({ ...profile, heroMedia: asset("hero") }).heroMedia).toEqual(asset("hero"));
  });

  it("no longer sends a defaultSeo.ogImage — that copy was never read by the storefront", () => {
    const form = storeProfileToForm({ ...profile, defaultSeo: { ogImage: asset("legacy") } });
    form.seoTitle = { ar: "عنوان", en: "" };
    expect(toStoreProfileBody(form).defaultSeo).toEqual({ title: { ar: "عنوان", en: "" } });
  });

  it("drops blank SEO text rather than writing empty strings", () => {
    expect(toStoreProfileBody(storeProfileToForm(profile)).defaultSeo).toEqual({});
  });
});

describe("theme body", () => {
  it("round-trips the schema defaults when nothing was saved yet", () => {
    const body = toThemeBody(themeToForm({}));
    expect(body.brand.radiusScale).toBe(1);
    expect(body.theme).toEqual({ defaultGround: "light", darkEnabled: false, allowVisitorChoice: false, tokenOverrides: [] });
  });
  it("converts the radius to a number and trims hex values", () => {
    const form = themeToForm({});
    form.brand.radiusScale = "1.25";
    form.brand.primary = " #6B8F71 ";
    form.theme.tokenOverrides = [{ key: "accent", value: " #aabbcc " }];
    const body = toThemeBody(form);
    expect(body.brand.radiusScale).toBe(1.25);
    expect(body.brand.primary).toBe("#6B8F71");
    expect(body.theme.tokenOverrides).toEqual([{ key: "accent", value: "#aabbcc" }]);
  });
});

describe("payment methods body", () => {
  const stored: PaymentMethod = {
    method: "BANK_TRANSFER",
    enabled: true,
    order: 2,
    destination: { accountName: "شركة المتجر", number: "EG12 0001", handle: undefined },
    requiresProof: true,
    requiresProviderIntegration: true,
    autoCancelMinutes: 60,
  };

  it("round-trips a stored method, including the field this screen cannot edit", () => {
    const [back] = toPaymentMethods(paymentToForm([stored]));
    expect(back).toMatchObject({ ...stored, destination: { accountName: "شركة المتجر", number: "EG12 0001" }, verificationWindowMinutes: undefined });
    expect(back?.requiresProviderIntegration).toBe(true);
  });

  it("omits an all-blank destination and blank minutes instead of sending empty strings or NaN", () => {
    const m = emptyPaymentMethod(0);
    m.method = " COD ";
    const [out] = toPaymentMethods({ methods: [m] });
    expect(out?.method).toBe("COD");
    expect(out?.destination).toBeUndefined();
    expect(out?.instructions).toBeUndefined();
    expect(out?.autoCancelMinutes).toBeUndefined();
    expect(out?.order).toBe(0);
  });
});

describe("describePaymentChanges", () => {
  const a: PaymentMethod = { method: "WALLET", enabled: true, destination: { number: "0100" } };
  it("reports nothing when only unrelated fields differ", () => {
    expect(describePaymentChanges([a], [{ ...a, order: 3, requiresProof: true }])).toEqual([]);
  });
  it("reports a changed destination, an added, a removed and a toggled method", () => {
    const lines = describePaymentChanges(
      [a, { method: "COD", enabled: true }, { method: "OLD" }],
      [{ ...a, destination: { number: "0111" } }, { method: "COD", enabled: false }, { method: "NEW" }],
    );
    expect(lines).toEqual(['Changes the destination of "WALLET".', 'Turns off "COD".', 'Adds "NEW".', 'Removes "OLD".']);
  });
  it("ignores whitespace-only destination edits", () => {
    expect(describePaymentChanges([a], [{ ...a, destination: { number: " 0100 " } }])).toEqual([]);
  });
});

describe("notification body", () => {
  it("round-trips events and splits recipient roles", () => {
    const form = notificationsToForm({ events: [{ event: "ORDER_PLACED", channels: ["EMAIL"], recipientRoles: ["owner", "manager"] }] });
    expect(form.events[0]?.recipientRoles).toBe("owner, manager");
    form.events[0]!.recipientRoles = "owner, , support ";
    form.events[0]!.event = " ORDER_PLACED ";
    expect(toNotificationBody(form)).toEqual({ events: [{ event: "ORDER_PLACED", channels: ["EMAIL"], recipientRoles: ["owner", "support"] }] });
  });
});
