import { MATRIX_COLUMN_ACTIONS, PERMISSION_SECTIONS, type MatrixColumn } from "src/common/authorization/permission-catalog";
import { humanizeEntity } from "./role-permissions";

export interface MatrixPermission {
  key: string;
  entity: string;
  action: string;
  name: string;
}

export interface MatrixRow {
  entity: string;
  label: string;
  /** The keys behind each CRUD column; empty when the module has no such permission. "View" can carry two (list + one). */
  columns: Record<MatrixColumn, string[]>;
  /** Actions that are not CRUD — "Verify payment", "Export orders (CSV)" — with their own names. */
  special: Array<{ key: string; label: string }>;
}

export interface MatrixSection {
  label: string;
  rows: MatrixRow[];
}

export const MATRIX_COLUMNS: Array<{ column: MatrixColumn; label: string }> = [
  { column: "view", label: "View" },
  { column: "create", label: "Create" },
  { column: "update", label: "Edit" },
  { column: "delete", label: "Delete" },
];

const CRUD_ACTIONS = new Set(Object.values(MATRIX_COLUMN_ACTIONS).flat());

/**
 * Lays the assignable permissions out as sections → modules → columns, in the console navigation's order. A module
 * with no assignable permission is dropped; an entity the catalog does not place lands under "Other", never lost.
 */
export function buildMatrix(permissions: readonly MatrixPermission[]): MatrixSection[] {
  const byEntity = new Map<string, MatrixPermission[]>();
  for (const permission of permissions) byEntity.set(permission.entity, [...(byEntity.get(permission.entity) ?? []), permission]);

  const row = (entity: string, label: string): MatrixRow | null => {
    const entries = byEntity.get(entity);
    if (!entries?.length) return null;
    const columns = Object.fromEntries(
      (Object.keys(MATRIX_COLUMN_ACTIONS) as MatrixColumn[]).map((column) => [
        column,
        entries.filter((entry) => MATRIX_COLUMN_ACTIONS[column].includes(entry.action)).map((entry) => entry.key).sort(),
      ])
    ) as Record<MatrixColumn, string[]>;
    const special = entries
      .filter((entry) => !CRUD_ACTIONS.has(entry.action))
      .map((entry) => ({ key: entry.key, label: entry.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { entity, label, columns, special };
  };

  const placed = new Set<string>();
  const sections: MatrixSection[] = [];
  for (const section of PERMISSION_SECTIONS) {
    const rows = section.modules.flatMap((module) => {
      placed.add(module.entity);
      const built = row(module.entity, module.label);
      return built ? [built] : [];
    });
    if (rows.length) sections.push({ label: section.label, rows });
  }
  const leftovers = [...byEntity.keys()].filter((entity) => !placed.has(entity)).sort();
  const other = leftovers.flatMap((entity) => {
    const built = row(entity, humanizeEntity(entity));
    return built ? [built] : [];
  });
  if (other.length) sections.push({ label: "Other", rows: other });
  return sections;
}

/** Every key a row offers. */
export function rowKeys(row: MatrixRow): string[] {
  return [...Object.values(row.columns).flat(), ...row.special.map((entry) => entry.key)];
}

export type CellState = "on" | "off" | "partial";

/** A cell is on when every key behind it is held, partial when some are. */
export function cellState(keys: readonly string[], selected: ReadonlySet<string>): CellState {
  const held = keys.filter((key) => selected.has(key)).length;
  return held === 0 ? "off" : held === keys.length ? "on" : "partial";
}

/** Turning a cell on grants every key behind it; turning it off removes them all. Returns a new set. */
export function toggleKeys(selected: ReadonlySet<string>, keys: readonly string[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const key of keys) {
    if (on) next.add(key);
    else next.delete(key);
  }
  return next;
}
