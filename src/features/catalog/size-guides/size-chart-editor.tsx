"use client";

import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { Plus, X } from "lucide-react";
import type { SizeChart } from "src/api/size-guides.endpoints";
import { addColumn, addRow, removeColumn, removeRow, setCell, setHeader } from "./size-chart";

/**
 * The chart as an editable grid: headings across the top, one row per size.
 * Wide charts scroll inside their own frame, never the page. Cells take
 * `dir="auto"` — headings are often Arabic, measurements Latin.
 */
export function SizeChartEditor({ value, onChange, error, disabled }: { value: SizeChart; onChange: (chart: SizeChart) => void; error?: string; disabled?: boolean }) {
  const columnName = (index: number) => value.headers[index]?.trim() || `column ${index + 1}`;
  const rowName = (index: number) => value.rows[index]?.[0]?.trim() || `row ${index + 1}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-md border border-[var(--st-line)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[var(--st-canvas)]">
              {value.headers.map((header, column) => (
                <th key={column} scope="col" className="min-w-36 p-2 align-top font-normal">
                  <div className="flex items-center gap-1">
                    <CustomInput
                      aria-label={column === 0 ? "Size column heading" : `Heading of ${columnName(column)}`}
                      dir="auto"
                      value={header}
                      placeholder={column === 0 ? "Size" : "e.g. Chest (cm)"}
                      disabled={disabled}
                      onChange={(event) => onChange(setHeader(value, column, event.target.value))}
                    />
                    {column > 0 && value.headers.length > 2 ? (
                      <CustomButton type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${columnName(column)} column`}
                        disabled={disabled}
                        onClick={() => onChange(removeColumn(value, column))}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </CustomButton>
                    ) : null}
                  </div>
                </th>
              ))}
              <th aria-hidden="true" className="w-12" />
            </tr>
          </thead>
          <tbody>
            {value.rows.map((cells, row) => (
              <tr key={row} className="border-t border-[var(--st-line)]">
                {cells.map((cell, column) => (
                  <td key={column} className="p-2">
                    <CustomInput
                      aria-label={column === 0 ? `Size, row ${row + 1}` : `${columnName(column)} for ${rowName(row)}`}
                      dir="auto"
                      value={cell}
                      disabled={disabled}
                      onChange={(event) => onChange(setCell(value, row, column, event.target.value))}
                    />
                  </td>
                ))}
                <td className="p-2">
                  {value.rows.length > 1 ? (
                    <CustomButton type="button" variant="ghost" size="icon" aria-label={`Remove ${rowName(row)}`} disabled={disabled} onClick={() => onChange(removeRow(value, row))}>
                      <X className="size-4" aria-hidden="true" />
                    </CustomButton>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <CustomButton type="button" variant="outline" leftIcon={Plus} disabled={disabled} onClick={() => onChange(addRow(value))}>
          Add size
        </CustomButton>
        <CustomButton type="button" variant="outline" leftIcon={Plus} disabled={disabled} onClick={() => onChange(addColumn(value))}>
          Add measurement
        </CustomButton>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] font-medium text-[var(--st-status-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
