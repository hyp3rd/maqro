"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildIssueUrl } from "@/lib/links";
import { useState } from "react";
import { Bug, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

const APP_VERSION = "0.1.0";
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/** Pre-fills a GitHub "new issue" URL with the user's title + body, plus
 *  an auto-collected context block (app version, browser UA, the page
 *  they were on). Opening the URL takes them to GitHub where they
 *  review and click Submit themselves - no backend, no token, no
 *  tracking from us. The context block is shown in the form so the
 *  user can edit or omit anything sensitive before opening GitHub. */
export function BugReportDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-lg">
        {open && <BugReportBody onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function BugReportBody({ onClose }: { onClose: () => void }) {
  const t = useTranslations("bugReport");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [includeContext, setIncludeContext] = useState(true);

  const userAgent =
    typeof navigator !== "undefined" ? navigator.userAgent : "(unknown)";
  // The pathname is non-sensitive (no query / hash / search params).
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "/";

  function buildBody(): string {
    // Body content uses translated headings so an Italian user
    // filing an issue against an English-speaking repo still has
    // their context block in the language they read it. The
    // headings are not the conversational text — they're labels —
    // so translation here doesn't fragment the issue tracker.
    const parts: string[] = [];
    parts.push(`**${t("context.describe")}**`);
    parts.push(description.trim() || t("context.describePlaceholder"));
    parts.push("");
    parts.push(`**${t("context.stepsTitle")}**`);
    parts.push("1. ");
    parts.push("2. ");
    parts.push("");
    parts.push(`**${t("context.expectedTitle")}**`);
    parts.push("");
    if (includeContext) {
      parts.push("---");
      parts.push(`*${t("context.autoIncluded")}*`);
      parts.push(`- ${t("context.appVersion")}: ${APP_VERSION}`);
      parts.push(`- ${t("context.browser")}: ${userAgent}`);
      parts.push(`- ${t("context.page")}: ${pathname}`);
    }
    return parts.join("\n");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = buildIssueUrl({
      title: title.trim() || t("context.defaultTitle"),
      body: buildBody(),
      labels: ["bug"],
    });
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  }

  const canSubmit = description.trim().length > 0;

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Bug className="h-4 w-4" />
          {t("title")}
        </DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label
            htmlFor="bug-title"
            className="text-xs font-medium"
          >
            {t("fields.titleLabel")}
          </Label>
          <Input
            id="bug-title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
            placeholder={t("fields.titlePlaceholder")}
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="bug-description"
            className="text-xs font-medium"
          >
            {t("fields.descriptionLabel")}
            <span className="ml-2 text-[10px] text-muted-foreground">
              {t("fields.descriptionCount", {
                count: description.length,
                max: DESCRIPTION_MAX,
              })}
            </span>
          </Label>
          <Textarea
            id="bug-description"
            value={description}
            onChange={(e) =>
              setDescription(e.target.value.slice(0, DESCRIPTION_MAX))
            }
            placeholder={t("fields.descriptionPlaceholder")}
            rows={5}
            required
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(e) => setIncludeContext(e.target.checked)}
            className="mt-0.5 h-3 w-3"
          />
          <span className="text-muted-foreground">{t("context.checkbox")}</span>
        </label>
      </div>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
        >
          {t("actions.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit}
        >
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          {t("actions.openIssue")}
        </Button>
      </DialogFooter>
    </form>
  );
}
