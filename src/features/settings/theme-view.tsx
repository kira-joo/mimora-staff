"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomForm, FieldType, FormInput, FormSelect, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { PageShell, QueryState, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CircleAlert, CircleCheck, Moon, Wand2 } from "lucide-react";
import { useMemo } from "react";
import { useForm, useWatch, type Control, type UseFormReturn } from "react-hook-form";
import { getStoreProfileEndpoint, updateThemeEndpoint, type StoreProfile } from "src/api/settings.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { usePermission } from "src/features/auth/use-permission";
import { HEX_COLOR, disableFields, isHexColor } from "./settings-helpers";
import { themeToForm, toThemeBody, type ThemeFormValues } from "./settings-bodies";
import { AddRowButton, ReadOnlyNotice, RowFrame, SettingsNote } from "./settings-fields";
import { MIN_CONTRAST_RATIO, measureFill, measureText } from "./theme-preview";

type Form = ThemeFormValues;

const HEX_RULES = { required: "Enter a colour", pattern: { value: HEX_COLOR, message: "Use a six-digit hex colour, e.g. #1A2B3C." } };

/** Colours are content here: whatever the owner types is shown as typed. Everything around them is the console's own tokens. */
function Swatch({ hex }: { hex: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="block size-11 shrink-0 border border-[var(--st-line-strong)] bg-[var(--st-canvas)]"
      style={isHexColor(hex) ? { background: hex } : undefined}
    />
  );
}

function HexInput({ control, name, label, description, disabled }: { control: Control<Form>; name: "brand.primary" | "brand.accent" | "brand.surface" | "brand.text" | `theme.tokenOverrides.${number}.value`; label: string; description?: string; disabled: boolean }) {
  const value = useWatch({ control, name }) as string | undefined;
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <FormInput control={control} name={name} label={label} description={description} dir="ltr" controlClassName="st-figure" disabled={disabled} rules={HEX_RULES} />
      </div>
      <div className="mt-[1.625rem]">
        <Swatch hex={value} />
      </div>
    </div>
  );
}

function colourField(name: "brand.primary" | "brand.accent" | "brand.surface" | "brand.text", label: string, description: string, disabled: boolean) {
  return {
    type: FieldType.CUSTOM as const,
    name,
    render: ({ form }: { form: UseFormReturn<Form> }) => <HexInput control={form.control} name={name} label={label} description={description} disabled={disabled} />,
  };
}

/** D-S4 — the curated pairings, matching the backend's `TYPOGRAPHY_CHOICES`. */
const TYPOGRAPHY_OPTIONS = [
  { value: "default", label: "Editorial — Noto Naskh Arabic headings, Noto Sans Arabic text" },
  { value: "contemporary", label: "Contemporary — Noto Kufi Arabic headings, Noto Sans Arabic text" },
  { value: "neutral", label: "Neutral — IBM Plex Sans Arabic throughout" },
];

const OVERRIDE_KEYS = [
  { value: "primary", label: "Primary fill" },
  { value: "accent", label: "Accent fill" },
];

function TokenOverrides({ value: overrides, onChange, form, disabled }: { value: Form["theme"]["tokenOverrides"]; onChange: (value: Form["theme"]["tokenOverrides"]) => void; form: UseFormReturn<Form>; disabled: boolean }) {
  const free = OVERRIDE_KEYS.find((k) => !overrides.some((o) => o.key === k.value));
  return (
    <div className="flex flex-col gap-3">
      {overrides.length === 0 ? <SettingsNote>No overrides. The storefront uses the brand colours above.</SettingsNote> : null}
      {overrides.map((override, index) => (
        <RowFrame key={index} title={OVERRIDE_KEYS.find((k) => k.value === override.key)?.label ?? "Override"} disabled={disabled} onRemove={() => onChange(form.getValues("theme.tokenOverrides").filter((_, i) => i !== index))}>
          <div className="grid gap-4 md:grid-cols-2">
            <FormSelect control={form.control} name={`theme.tokenOverrides.${index}.key`} label="Replaces" options={OVERRIDE_KEYS} disabled={disabled} rules={{ required: true }} />
            <HexInput control={form.control} name={`theme.tokenOverrides.${index}.value`} label="Colour" disabled={disabled} />
          </div>
        </RowFrame>
      ))}
      {disabled || !free ? null : <AddRowButton onClick={() => onChange([...form.getValues("theme.tokenOverrides"), { key: free.value as "primary" | "accent", value: "#111111" }])}>Add an override</AddRowButton>}
    </div>
  );
}

function buildSections(readOnly: boolean): FormSection<Form>[] {
  return disableFields<Form>(
    [
      {
        title: "Brand colours",
        description: "The storefront's light ground. Text colours on a fill are derived from it automatically, so a fill never produces unreadable text.",
        layout: "grid",
        columns: 2,
        fields: [
          colourField("brand.primary", "Primary", "Main buttons and links. Darkened or lightened on each ground only as far as needed to stay readable.", readOnly),
          colourField("brand.accent", "Accent", "Category labels, bands and the announcement bar. Adjusted per ground the same way.", readOnly),
          colourField("brand.surface", "Surface", "Stored only. The storefront uses its own designed page backgrounds, so text always stays readable.", readOnly),
          colourField("brand.text", "Text", "Stored only. The storefront uses its own designed text colours on each ground.", readOnly),
        ],
      },
      {
        title: "Shape and type",
        layout: "grid",
        columns: 2,
        fields: [
          {
            type: FieldType.INPUT,
            name: "brand.radiusScale",
            inputType: "number",
            label: "Corner radius scale",
            description: "1 is the storefront's standard. 0.5 to 2.",
            rules: { required: true, min: { value: 0.5, message: "Must be at least 0.5" }, max: { value: 2, message: "Must be at most 2" } },
          },
          {
            type: FieldType.RADIO_GROUP,
            name: "brand.typographyChoice",
            label: "Typography",
            description: "Each pairing covers Arabic and English.",
            orientation: "vertical",
            options: TYPOGRAPHY_OPTIONS,
          },
        ],
      },
      {
        title: "Ground",
        description: "Which background the storefront opens on, and whether visitors can switch.",
        columns: 1,
        fields: [
          {
            type: FieldType.RADIO_GROUP,
            name: "theme.defaultGround",
            label: "Default ground",
            orientation: "horizontal",
            options: [
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ],
          },
          { type: FieldType.SWITCH, name: "theme.darkEnabled", label: "Offer the dark ground", description: "The dark palette is always derived from the brand colours." },
          { type: FieldType.SWITCH, name: "theme.allowVisitorChoice", label: "Let visitors choose their ground" },
        ],
      },
      {
        title: "Fill overrides",
        description: "Use an exact primary or accent fill on the storefront. Where it would not be readable on a ground, that ground uses the adjusted brand colour instead. Text, borders and status colours always stay derived.",
        columns: 1,
        fields: [
          {
            type: FieldType.CUSTOM,
            name: "theme.tokenOverrides",
            render: ({ field, form }) => (
              <TokenOverrides value={(field.value as Form["theme"]["tokenOverrides"] | undefined) ?? []} onChange={field.onChange} form={form} disabled={readOnly} />
            ),
          },
        ],
      },
    ],
    readOnly,
  );
}

const ratio = (n: number) => `${n.toFixed(2)}:1`;

/**
 * The before-you-save preview: for each brand fill, what the storefront will actually draw on the light ground,
 * measured by the backend's own derivation engine (imported, not re-implemented).
 */
function ThemePreview({ control }: { control: Control<Form> }) {
  const brand = useWatch({ control, name: "brand" });
  const overrides = useWatch({ control, name: "theme.tokenOverrides" }) ?? [];
  const surface = brand?.surface ?? "";

  const rows = [
    { label: "Primary", fill: brand?.primary ?? "" },
    { label: "Accent", fill: brand?.accent ?? "" },
    ...overrides.map((o) => ({ label: `Override: ${o.key}`, fill: o?.value ?? "" })),
  ].map((row) => ({ ...row, measured: measureFill(row.fill, surface) }));
  const text = measureText(brand?.text ?? "", surface);
  const surfaceOk = isHexColor(surface);

  return (
    <section aria-labelledby="theme-preview" className="flex flex-col gap-3 border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
      <div>
        <h2 id="theme-preview" className="text-[16px] font-semibold text-[var(--st-ink)]">
          Preview on the light ground
        </h2>
        <p className="text-[var(--st-ink-muted)]">Measured against the surface colour. The storefront needs {MIN_CONTRAST_RATIO}:1 for text.</p>
      </div>

      {surfaceOk ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.label} className="grid items-center gap-2 border border-[var(--st-line)] p-3 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.4fr)]">
              <span className="font-medium text-[var(--st-ink)]">{row.label}</span>
              {row.measured ? (
                <>
                  <span className="flex items-center gap-3 p-2" style={{ background: surface }}>
                    <span aria-hidden="true" className="block size-6 shrink-0 border border-[var(--st-line-strong)]" style={{ background: row.measured.fillHex }} />
                    <span className="font-semibold" style={{ color: row.measured.inkHex }}>
                      Sample text
                    </span>
                  </span>
                  <span className="flex items-start gap-2 text-[var(--st-ink)]">
                    {row.measured.adjusted ? (
                      <Wand2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--st-status-pending)]" />
                    ) : (
                      <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--st-status-done)]" />
                    )}
                    <span>
                      {row.measured.adjusted ? (
                        <>
                          The fill alone reads {ratio(row.measured.fillRatio)}, so text on it uses{" "}
                          <bdi dir="ltr" className="st-figure">
                            {row.measured.inkHex}
                          </bdi>{" "}
                          ({ratio(row.measured.inkRatio)}).
                        </>
                      ) : (
                        <>Readable as is: {ratio(row.measured.fillRatio)}.</>
                      )}
                    </span>
                  </span>
                </>
              ) : (
                <span className="text-[var(--st-ink-muted)] md:col-span-2">Enter a complete six-digit colour to preview it.</span>
              )}
            </li>
          ))}
          <li className="flex items-start gap-2 border border-[var(--st-line)] p-3">
            {text ? (
              text.meetsMinimum ? (
                <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--st-status-done)]" />
              ) : (
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--st-status-danger)]" />
              )
            ) : (
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--st-ink-muted)]" />
            )}
            <span className="text-[var(--st-ink)]">
              {text
                ? text.meetsMinimum
                  ? `Body text on the surface: ${ratio(text.ratio)}.`
                  : `Body text on the surface is hard to read (${ratio(text.ratio)}). It is used as entered; the storefront does not adjust it.`
                : "Enter a complete text colour to measure it."}
            </span>
          </li>
        </ul>
      ) : (
        <SettingsNote>Enter a complete six-digit surface colour to see the preview.</SettingsNote>
      )}

      <p className="flex items-start gap-2 text-[var(--st-ink-muted)]">
        <Moon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>Dark ground: not measured. There is no reviewed dark-ground colour yet, so the server skips it too. The dark palette is derived later from the fills above.</span>
      </p>
    </section>
  );
}

function ThemeForm({ profile, canUpdate }: { profile: StoreProfile; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const form = useForm<Form>({ defaultValues: themeToForm(profile) });
  const sections = useMemo(() => buildSections(!canUpdate), [canUpdate]);

  return (
    <CustomForm<Form, typeof updateThemeEndpoint>
      form={form}
      mode="edit"
      sections={sections}
      submitEndpoint={updateThemeEndpoint}
      transformValues={toThemeBody}
      submitButtonText="Save theme"
      hideDefaultActions={!canUpdate}
      warnOnUnsavedChanges
      onSuccess={(result) => {
        form.reset(themeToForm(result.profile));
        void queryClient.invalidateQueries();
        toast.success("Theme saved");
      }}
    >
      <ThemePreview control={form.control} />
    </CustomForm>
  );
}

/** Brand colours, ground and fill overrides. Its own `PUT .../theme` route is the one write path that measures contrast; the saved values come from the store-profile read. */
export function ThemeView() {
  const can = usePermission();
  const canUpdate = can(AppPermission.STORE_PROFILE.UPDATE);
  const query = useRequesterQuery({ endpoint: getStoreProfileEndpoint });
  return (
    <QueryState query={query} entityName="theme">
      {(profile) => (
        <PageShell title="Theme" description="The storefront's colours, shape and ground." maxWidth="3xl">
          {canUpdate ? null : <ReadOnlyNotice />}
          <ThemeForm key={profile.updatedAt} profile={profile} canUpdate={canUpdate} />
        </PageShell>
      )}
    </QueryState>
  );
}
