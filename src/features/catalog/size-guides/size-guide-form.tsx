"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { useRouter } from "next/navigation";
import type { createSizeGuideEndpoint, updateSizeGuideEndpoint, SizeGuide, SizeGuideInput } from "src/api/size-guides.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { displayName } from "../catalog-display";
import { EMPTY_CHART, chartProblem, cleanChart, readChart } from "./size-chart";
import { SizeChartEditor } from "./size-chart-editor";

const SECTIONS: FormSection<SizeGuideInput>[] = [
  {
    title: "Guide",
    description: "Products link to a guide; the storefront shows it beside the size picker.",
    columns: 1,
    fields: [
      { type: FieldType.LOCALIZED_INPUT, name: "name", label: "Name" },
      { type: FieldType.LOCALIZED_TEXTAREA, name: "description", label: "How to measure", rows: 3 },
    ],
  },
  {
    title: "Chart",
    description: "One row per size. The first column is the size customers pick.",
    columns: 1,
    fields: [
      {
        type: FieldType.CUSTOM,
        name: "chartData",
        rules: { validate: (chart) => chartProblem(chart as SizeGuideInput["chartData"]) ?? true },
        render: ({ field, error }) => <SizeChartEditor value={field.value as SizeGuideInput["chartData"]} onChange={field.onChange} error={error} disabled={field.disabled} />,
      },
    ],
  },
];

const EMPTY_TEXT = { ar: "", en: "" };

export interface SizeGuideFormProps {
  endpoint: typeof createSizeGuideEndpoint | typeof updateSizeGuideEndpoint;
  oldData?: SizeGuide;
}

/** API shape → form values. Stored `chartData` is free-form JSON, so it is normalised into a rectangular chart here. */
export function mapSizeGuideToFormValues(oldData?: SizeGuide): SizeGuideInput {
  return {
    name: oldData?.name ?? EMPTY_TEXT,
    description: oldData?.description ?? EMPTY_TEXT,
    chartData: oldData ? readChart(oldData.chartData) : structuredClone(EMPTY_CHART),
  };
}

/** Owns the chart: the grid editor, its validation, and the clean-up (trimmed cells, blank rows dropped) before save. */
export function SizeGuideForm({ endpoint, oldData }: SizeGuideFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = Boolean(oldData);

  return (
    <CustomForm<SizeGuideInput, typeof endpoint>
      mode={isEdit ? "edit" : "create"}
      sections={SECTIONS}
      defaultValues={mapSizeGuideToFormValues(oldData)}
      submitEndpoint={endpoint}
      submitParams={oldData ? { id: oldData._id } : undefined}
      transformValues={(values) => ({ ...values, chartData: cleanChart(values.chartData) })}
      submitButtonText={isEdit ? "Save size guide" : "Create size guide"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        toast.success(isEdit ? "Size guide saved" : `${displayName(saved.name)} created`);
        router.push(AppRoute.SIZE_GUIDES);
      }}
    />
  );
}
