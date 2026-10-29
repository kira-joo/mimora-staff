"use client";

import { getApiErrorStatusCode, isApiError, requester } from "@kira-joo/frontend-toolkit-core";
import { useConfirm } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomButton, showApiErrorToast, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Eye, Rocket } from "lucide-react";
import { useState } from "react";
import {
  previewStorefrontContentEndpoint,
  publishStorefrontContentEndpoint,
  type StorefrontContentAdminView,
  type StorefrontContentPreview,
} from "src/api/storefront-content.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { describeProblemField, SECTION_LABELS } from "./storefront-content-values";

interface PublishPanelProps {
  /** The saved record: what the draft revision is, and what is live. */
  content: StorefrontContentAdminView;
  /** The form has edits that are not saved yet — a preview or a publish would be of the OLD draft. */
  dirty: boolean;
  canPublish: boolean;
}

const pick = (text: { ar: string; en: string } | undefined) => text?.en || text?.ar || "";

function StatusLine({ content }: { content: StorefrontContentAdminView }) {
  const { dateTime } = useStoreFormat();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="font-medium text-[var(--st-ink)]">{content.publishedAt ? `Live since ${dateTime(content.publishedAt)}` : "Not published yet"}</span>
      {content.hasUnpublishedChanges ? (
        <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--st-status-pending)" }}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          Unpublished changes
        </span>
      ) : content.publishedAt ? (
        <span className="text-[var(--st-ink-muted)]">Draft matches what is live</span>
      ) : null}
    </div>
  );
}

function PreviewResult({ preview, draftSectionTypes }: { preview: StorefrontContentPreview; draftSectionTypes: StorefrontContentAdminView["draft"]["homeSections"] }) {
  const { view, problems } = preview;
  const omitted = draftSectionTypes.length - view.homeSections.length;
  return (
    <div className="flex flex-col gap-4">
      {problems.length > 0 ? (
        <div role="alert" className="flex flex-col gap-2 border border-[var(--st-status-danger)] p-3">
          <p className="flex items-center gap-2 font-medium text-[var(--st-status-danger)]">
            <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
            {problems.length === 1 ? "1 problem stops this going live" : `${problems.length} problems stop this going live`}
          </p>
          <ul className="flex flex-col gap-1.5">
            {problems.map((problem) => (
              <li key={problem.field} className="text-[var(--st-ink)]">
                <span className="font-medium">{describeProblemField(problem.field, draftSectionTypes)}</span>
                <span className="text-[var(--st-ink-muted)]"> — {problem.messages.join(" ")}</span>
              </li>
            ))}
          </ul>
          <p className="text-[var(--st-ink-muted)]">Fix these in the form, save the draft, and preview again.</p>
        </div>
      ) : (
        <p className="flex items-center gap-2 font-medium text-[var(--st-status-done)]">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          No problems. This draft can go live.
        </p>
      )}

      <dl className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-[13px] text-[var(--st-ink-muted)]">Announcement shown now</dt>
          <dd dir="auto" className="break-words text-[var(--st-ink)]">
            {view.announcement ? pick(view.announcement.message) : "None"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[13px] text-[var(--st-ink-muted)]">Header links</dt>
          <dd dir="auto" className="break-words text-[var(--st-ink)]">
            {view.headerNavigation.length ? view.headerNavigation.map((link) => pick(link.label)).join(" · ") : "None"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[13px] text-[var(--st-ink-muted)]">Footer links</dt>
          <dd dir="auto" className="break-words text-[var(--st-ink)]">
            {view.footerNavigation.length ? view.footerNavigation.map((link) => pick(link.label)).join(" · ") : "None"}
            {view.legalLinks.length ? <span className="text-[var(--st-ink-muted)]"> (plus {view.legalLinks.length} legal {view.legalLinks.length === 1 ? "page" : "pages"}, always shown)</span> : null}
          </dd>
        </div>
        <div className="min-w-0 md:col-span-2">
          <dt className="text-[13px] text-[var(--st-ink-muted)]">Home sections, top to bottom</dt>
          <dd>
            {view.homeSections.length === 0 ? (
              <span className="text-[var(--st-ink)]">None</span>
            ) : (
              <ol className="list-decimal ps-5 text-[var(--st-ink)]">
                {view.homeSections.map((section, index) => {
                  const heading = pick((section.headline ?? section.heading) as { ar: string; en: string } | undefined);
                  return (
                    <li key={index} dir="auto" className="break-words">
                      {SECTION_LABELS[section.type]}
                      {heading ? <span className="text-[var(--st-ink-muted)]"> · {heading}</span> : null}
                    </li>
                  );
                })}
              </ol>
            )}
            {omitted > 0 ? (
              <span className="mt-1 block text-[var(--st-ink-muted)]">
                {omitted} {omitted === 1 ? "section is" : "sections are"} left out because what {omitted === 1 ? "it points" : "they point"} at isn't available to customers.
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Where a saved draft becomes what customers see. Publish is armed only by a preview of the CURRENT draft revision
 * with no problems — the server checks both again (409 when the draft moved on, 400 when something would show a gap).
 */
export function PublishPanel({ content, dirty, canPublish }: PublishPanelProps) {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [preview, setPreview] = useState<StorefrontContentPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);
  const [stale, setStale] = useState(false);

  const currentPreview = preview && preview.draftRevision === content.draftRevision ? preview : null;
  const canPublishNow = canPublish && !dirty && content.hasUnpublishedChanges && currentPreview !== null && currentPreview.problems.length === 0;

  async function runPreview() {
    setBusy("preview");
    setStale(false);
    try {
      setPreview(await requester(previewStorefrontContentEndpoint));
    } catch (error) {
      showApiErrorToast(isApiError(error) ? error : { message: "Something went wrong. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!currentPreview) return;
    const ok = await confirm({
      title: "Publish to the storefront?",
      description: "Customers see this draft right away: the announcement, navigation and home sections you previewed.",
      confirmLabel: "Publish",
    });
    if (!ok) return;
    setBusy("publish");
    try {
      await requester(publishStorefrontContentEndpoint, { body: { draftRevision: currentPreview.draftRevision } });
      toast.success("Published. Customers now see this content.");
      setPreview(null);
      void queryClient.invalidateQueries();
    } catch (error) {
      if (getApiErrorStatusCode(error) === 409) {
        setStale(true);
        setPreview(null);
      } else {
        showApiErrorToast(isApiError(error) ? error : { message: "Something went wrong. Try again." });
        // A 400 means something would show a gap; the preview lists exactly what.
        if (getApiErrorStatusCode(error) === 400) await runPreview();
      }
    } finally {
      setBusy(null);
    }
  }

  const hint = dirty ? "Save the draft first. Previewing and publishing use the saved draft, not your unsaved edits." : null;

  return (
    <section aria-labelledby="publish-panel" className="flex flex-col gap-4 border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
      <div className="flex flex-col gap-1">
        <h2 id="publish-panel" className="text-[16px] font-semibold text-[var(--st-ink)]">
          Publish
        </h2>
        <StatusLine content={content} />
        <p className="text-[var(--st-ink-muted)]">Customers only see what is published. Saving a draft changes nothing on the storefront.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CustomButton type="button" variant="outline" className="min-h-11" onClick={runPreview} disabled={dirty || busy !== null} loading={busy === "preview"}>
          <Eye aria-hidden="true" className="size-4" />
          Preview draft
        </CustomButton>
        {canPublish ? (
          <CustomButton type="button" className="min-h-11" onClick={publish} disabled={!canPublishNow || busy !== null} loading={busy === "publish"}>
            <Rocket aria-hidden="true" className="size-4" />
            Publish
          </CustomButton>
        ) : null}
      </div>

      {hint ? <p className="text-[var(--st-ink-muted)]">{hint}</p> : null}
      {!hint && canPublish && !content.hasUnpublishedChanges ? <p className="text-[var(--st-ink-muted)]">There is nothing new to publish.</p> : null}
      {!hint && canPublish && content.hasUnpublishedChanges && !currentPreview ? <p className="text-[var(--st-ink-muted)]">Preview the draft to check it before publishing.</p> : null}
      {!canPublish ? <p className="text-[var(--st-ink-muted)]">Your role can prepare the draft but not publish it.</p> : null}

      {stale ? (
        <p role="alert" className="flex items-start gap-2 font-medium text-[var(--st-status-danger)]">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          The draft changed after you previewed it, so nothing was published. Preview it again, then publish.
        </p>
      ) : null}

      {currentPreview ? <PreviewResult preview={currentPreview} draftSectionTypes={content.draft.homeSections} /> : null}
    </section>
  );
}
