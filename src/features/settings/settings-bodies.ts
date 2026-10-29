import type { LocalizedString } from "@kira-joo/frontend-toolkit-core";
import type {
  NotificationChannel,
  NotificationEvent,
  NotificationSettings,
  PaymentMethod,
  StoreProfile,
  StoreProfileInput,
  StoredImage,
  StoreTheme,
  StoreBrand,
  ThemeInput,
} from "src/api/settings.endpoints";
import { blankToUndefined, joinList, splitList, toOptionalWholeNumber } from "./settings-helpers";

/*
 * Form values <-> wire bodies, one pair per screen. Every form holds text (that is what inputs produce);
 * conversion to the DTO's numbers and optional fields happens here, once, at the submit boundary.
 */

const isBlankLocalized = (value: LocalizedString | undefined) => !value || (!value.ar.trim() && !value.en.trim());
const localized = (value: LocalizedString | undefined): LocalizedString => ({ ar: value?.ar ?? "", en: value?.en ?? "" });

// --- Store profile ---------------------------------------------------------------------------------------------------

export interface StoreProfileFormValues {
  name: LocalizedString;
  tagline: LocalizedString;
  description: LocalizedString;
  contact: { phone: string; email: string; whatsApp: string };
  socialLinks: { platform: string; url: string }[];
  currency: string;
  defaultLocale: "ar" | "en";
  supportedLocales: string[];
  seoTitle: LocalizedString;
  seoDescription: LocalizedString;
  /** The store's identity imagery. `null` is "none": a slot holding it on save is removed. */
  logo: StoredImage | null;
  favicon: StoredImage | null;
  /** The social/link-preview image — the profile's own `ogImage`, the field the storefront reads (not `defaultSeo.ogImage`). */
  ogImage: StoredImage | null;
  heroMedia: StoredImage | null;
}

export function storeProfileToForm(profile: StoreProfile): StoreProfileFormValues {
  return {
    name: localized(profile.name),
    tagline: localized(profile.tagline),
    description: localized(profile.description),
    contact: { phone: profile.contact?.phone ?? "", email: profile.contact?.email ?? "", whatsApp: profile.contact?.whatsApp ?? "" },
    socialLinks: (profile.socialLinks ?? []).map((link) => ({ platform: link.platform, url: link.url })),
    currency: profile.currency ?? "",
    defaultLocale: profile.defaultLocale ?? "ar",
    // Unset (a deployment that never saved) means "just the default language", which is how the API itself reads it.
    supportedLocales: profile.supportedLocales?.length ? profile.supportedLocales : [profile.defaultLocale ?? "ar"],
    seoTitle: localized(profile.defaultSeo?.title),
    seoDescription: localized(profile.defaultSeo?.description),
    logo: profile.logo ?? null,
    favicon: profile.favicon ?? null,
    ogImage: profile.ogImage ?? null,
    heroMedia: profile.heroMedia ?? null,
  };
}

/**
 * Every image slot is sent as it stands: an asset keeps or replaces the slot, `null` removes it (the server then
 * destroys the stored file once the save has committed). The social image is the profile's own `ogImage`;
 * `defaultSeo` carries the title and description only, and the server merges it field by field, so a legacy
 * `defaultSeo.ogImage` on the document is neither shown nor erased here.
 */
export function toStoreProfileBody(values: StoreProfileFormValues): StoreProfileInput {
  const seo: NonNullable<StoreProfileInput["defaultSeo"]> = {};
  if (!isBlankLocalized(values.seoTitle)) seo.title = values.seoTitle;
  if (!isBlankLocalized(values.seoDescription)) seo.description = values.seoDescription;

  return {
    name: values.name,
    tagline: values.tagline,
    description: values.description,
    contact: { phone: values.contact.phone.trim(), email: values.contact.email.trim(), whatsApp: blankToUndefined(values.contact.whatsApp) },
    socialLinks: values.socialLinks.map((link) => ({ platform: link.platform.trim(), url: link.url.trim() })),
    currency: values.currency.trim().toUpperCase(),
    defaultLocale: values.defaultLocale,
    supportedLocales: values.supportedLocales,
    defaultSeo: seo,
    logo: values.logo,
    favicon: values.favicon,
    ogImage: values.ogImage,
    heroMedia: values.heroMedia,
  };
}

// --- Theme -----------------------------------------------------------------------------------------------------------

/** Matches the schema defaults, shown until the first save. */
export const DEFAULT_BRAND: StoreBrand = { primary: "#111111", accent: "#111111", surface: "#FFFFFF", text: "#111111", radiusScale: 1, typographyChoice: "default" };
export const DEFAULT_THEME: StoreTheme = { defaultGround: "light", darkEnabled: false, allowVisitorChoice: false, tokenOverrides: [] };

export interface ThemeFormValues {
  brand: { primary: string; accent: string; surface: string; text: string; radiusScale: string; typographyChoice: string };
  theme: StoreTheme;
}

export function themeToForm(profile: Pick<StoreProfile, "brand" | "theme">): ThemeFormValues {
  const brand = profile.brand ?? DEFAULT_BRAND;
  const theme = profile.theme ?? DEFAULT_THEME;
  return {
    brand: { ...brand, radiusScale: String(brand.radiusScale) },
    theme: { ...theme, tokenOverrides: (theme.tokenOverrides ?? []).map((o) => ({ key: o.key, value: o.value })) },
  };
}

export function toThemeBody(values: ThemeFormValues): ThemeInput {
  const { brand, theme } = values;
  return {
    brand: {
      primary: brand.primary.trim(),
      accent: brand.accent.trim(),
      surface: brand.surface.trim(),
      text: brand.text.trim(),
      radiusScale: Number(brand.radiusScale),
      typographyChoice: brand.typographyChoice.trim(),
    },
    theme: { ...theme, tokenOverrides: theme.tokenOverrides.map((o) => ({ key: o.key, value: o.value.trim() })) },
  };
}

// --- Payment settings ------------------------------------------------------------------------------------------------

export interface PaymentMethodFormValues {
  method: string;
  enabled: boolean;
  order: string;
  instructions: LocalizedString;
  destination: { accountName: string; number: string; handle: string };
  requiresProof: boolean;
  /** Carried through, never edited here. */
  requiresProviderIntegration: boolean;
  autoCancelMinutes: string;
  verificationWindowMinutes: string;
}

export interface PaymentFormValues {
  methods: PaymentMethodFormValues[];
}

export function emptyPaymentMethod(order: number): PaymentMethodFormValues {
  return {
    method: "",
    enabled: true,
    order: String(order),
    instructions: { ar: "", en: "" },
    destination: { accountName: "", number: "", handle: "" },
    requiresProof: false,
    requiresProviderIntegration: false,
    autoCancelMinutes: "",
    verificationWindowMinutes: "",
  };
}

export function paymentToForm(methods: PaymentMethod[]): PaymentFormValues {
  return {
    methods: methods.map((m) => ({
      method: m.method,
      enabled: m.enabled ?? true,
      order: String(m.order ?? 0),
      instructions: localized(m.instructions),
      destination: { accountName: m.destination?.accountName ?? "", number: m.destination?.number ?? "", handle: m.destination?.handle ?? "" },
      requiresProof: m.requiresProof ?? false,
      requiresProviderIntegration: m.requiresProviderIntegration ?? false,
      autoCancelMinutes: m.autoCancelMinutes === undefined ? "" : String(m.autoCancelMinutes),
      verificationWindowMinutes: m.verificationWindowMinutes === undefined ? "" : String(m.verificationWindowMinutes),
    })),
  };
}

export function toPaymentMethods(values: PaymentFormValues): PaymentMethod[] {
  return values.methods.map((m) => {
    const destination = {
      accountName: blankToUndefined(m.destination.accountName),
      number: blankToUndefined(m.destination.number),
      handle: blankToUndefined(m.destination.handle),
    };
    const hasDestination = Boolean(destination.accountName || destination.number || destination.handle);
    return {
      method: m.method.trim(),
      enabled: m.enabled,
      order: toOptionalWholeNumber(m.order),
      instructions: isBlankLocalized(m.instructions) ? undefined : m.instructions,
      destination: hasDestination ? destination : undefined,
      requiresProof: m.requiresProof,
      requiresProviderIntegration: m.requiresProviderIntegration,
      autoCancelMinutes: toOptionalWholeNumber(m.autoCancelMinutes),
      verificationWindowMinutes: toOptionalWholeNumber(m.verificationWindowMinutes),
    };
  });
}

const destinationKey = (m: PaymentMethod | undefined) =>
  JSON.stringify([m?.destination?.accountName?.trim() ?? "", m?.destination?.number?.trim() ?? "", m?.destination?.handle?.trim() ?? ""]);

/**
 * The plain-language list shown in the confirm: what is about to change about where customers send money.
 * Compared by method key, since that is the identity an order snapshots.
 */
export function describePaymentChanges(before: PaymentMethod[], after: PaymentMethod[]): string[] {
  const lines: string[] = [];
  const prior = new Map(before.map((m) => [m.method, m]));
  const next = new Map(after.map((m) => [m.method, m]));

  for (const m of after) {
    const old = prior.get(m.method);
    if (!old) {
      lines.push(`Adds "${m.method}"${m.enabled === false ? " (disabled)" : ""}.`);
      continue;
    }
    if (destinationKey(old) !== destinationKey(m)) lines.push(`Changes the destination of "${m.method}".`);
    if ((old.enabled ?? true) !== (m.enabled ?? true)) lines.push(`${m.enabled === false ? "Turns off" : "Turns on"} "${m.method}".`);
  }
  for (const m of before) if (!next.has(m.method)) lines.push(`Removes "${m.method}".`);
  return lines;
}

// --- Notification settings -------------------------------------------------------------------------------------------

export interface NotificationEventFormValues {
  event: string;
  channels: NotificationChannel[];
  /** Comma-separated; the API stores a list of role identifiers. */
  recipientRoles: string;
}

export interface NotificationFormValues {
  events: NotificationEventFormValues[];
}

export function notificationsToForm(settings: NotificationSettings): NotificationFormValues {
  return { events: (settings.events ?? []).map((e) => ({ event: e.event, channels: [...e.channels], recipientRoles: joinList(e.recipientRoles) })) };
}

export function toNotificationBody(values: NotificationFormValues): NotificationSettings {
  return {
    events: values.events.map((e): NotificationEvent => ({ event: e.event.trim(), channels: e.channels, recipientRoles: splitList(e.recipientRoles) })),
  };
}
