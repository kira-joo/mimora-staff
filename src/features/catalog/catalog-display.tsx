import type { LocalizedText } from "src/api/brands.endpoints";
import { TONE_VAR } from "src/features/status/status-vocabulary";

/** The name staff read first: English when present, else Arabic. */
export const displayName = (name: LocalizedText | undefined): string => (name ? name.en || name.ar : "");

/** A list cell for bilingual content: the display name, with the Arabic beneath when both exist. */
export function LocalizedNameCell({ name }: { name: LocalizedText }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span dir="auto" className="truncate font-medium">
        {displayName(name)}
      </span>
      {name.ar && name.en ? (
        <span dir="auto" className="truncate text-[13px] text-[var(--st-ink-muted)]">
          {name.ar}
        </span>
      ) : null}
    </div>
  );
}

/** Published / Unpublished — dot, colour and word together, never colour alone. */
export function VisibilitySignal({ published }: { published: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium" style={{ color: TONE_VAR[published ? "done" : "neutral"] }}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {published ? "Published" : "Unpublished"}
    </span>
  );
}

export const VISIBILITY_FILTER = {
  key: "published",
  header: "Visibility",
  options: [
    { value: "true", label: "Published" },
    { value: "false", label: "Unpublished" },
  ],
};
