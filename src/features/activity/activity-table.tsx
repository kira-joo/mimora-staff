"use client";

import { drawerPresentation, useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { FeatureTable } from "@kira-joo/frontend-toolkit-tailwind/table";
import { listActivityEndpoint, type ActivityEntry } from "src/api/activity.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { ACTION_OPTIONS, ENTITY_OPTIONS, humanize } from "./activity-display";
import { ActivityEntryDrawer } from "./activity-entry-drawer";

/** The audit log, newest first, filtered by what was touched and how. A row opens the full entry. */
export function ActivityTable() {
  const format = useStoreFormat();
  const { openDialog } = useDialog();

  const open = (entry: ActivityEntry) =>
    void openDialog<typeof ActivityEntryDrawer, void>({ component: ActivityEntryDrawer, props: { entry }, presentation: drawerPresentation({ side: "inline-end" }) });

  return (
    <FeatureTable<ActivityEntry>
      endpoint={listActivityEndpoint}
      entityName="activity"
      searchable={false}
      defaultLimit={25}
      filters={[
        { key: "entityType", header: "Record type", options: ENTITY_OPTIONS },
        { key: "action", header: "Action", options: ACTION_OPTIONS },
      ]}
      onRowClick={open}
      emptyMessage="No activity"
      emptyDescription="Every change staff make through the console is recorded here."
      columns={[
        { key: "at", header: "When", render: (row) => <span className="st-figure whitespace-nowrap">{format.dateTime(row.at)}</span> },
        {
          key: "actor",
          header: "Who",
          render: (row) => (
            <span dir="auto" className="block max-w-48 truncate">
              {row.actor.name ?? row.actor.email ?? "Unknown"}
            </span>
          ),
        },
        {
          key: "action",
          header: "What",
          render: (row) => (
            <span className="whitespace-nowrap">
              <span className="font-medium">{humanize(row.action)}</span> <span className="text-[var(--st-ink-muted)]">{humanize(row.entityType).toLowerCase()}</span>
            </span>
          ),
        },
      ]}
    />
  );
}
