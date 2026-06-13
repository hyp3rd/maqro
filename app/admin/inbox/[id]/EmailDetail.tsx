"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ReceivedAttachment,
  ReceivedEmailDetail,
} from "@/lib/email/receiving";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  Paperclip,
  Reply,
} from "lucide-react";
import { ComposeEmailDialog } from "../ComposeEmailDialog";

/** Detail view: header card with sender / subject / timestamp,
 *  body switcher between plain-text and rendered-HTML views, and
 *  collapsible panels for attachments + raw headers.
 *
 *  Why the HTML render is sandboxed: incoming email HTML is
 *  untrusted by definition — embedded `<script>`, tracking pixels,
 *  remote CSS imports, the works. A sandboxed iframe with no
 *  `allow-scripts` / `allow-same-origin` neuters all of that
 *  without losing the visual fidelity of the actual message. */
export function EmailDetail({
  email,
  attachments,
}: {
  email: ReceivedEmailDetail;
  attachments: ReceivedAttachment[];
}) {
  // Default to text — it's safer and renders instantly. HTML is one
  // click away. If only one is present, the toggle hides itself.
  const [mode, setMode] = useState<"text" | "html">(
    email.text ? "text" : "html",
  );
  const [headersOpen, setHeadersOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const hasBothBodies = Boolean(email.html && email.text);

  const initial = (email.from.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();

  // Reply pre-fill: address the inbound's sender, prefix the
  // subject with "Re:" (idempotent — don't pile up "Re: Re: Re:"),
  // and quote the original text body so the operator has context
  // in the compose window. Plain-text only — HTML quoting opens
  // up too many sanitisation edge cases for the marginal win.
  //
  // Recipient resolution mirrors what gmail / apple mail do:
  //   1. Reply-To header wins when present (RFC 5322 §3.6.2 —
  //      the sender explicitly nominated where replies should go).
  //   2. Otherwise fall back to the From header.
  // Either field may arrive as `"Name" <addr@x>` formatted text;
  // `extractAddress` strips the display name so the To input
  // shows a clean address (and the route's email-shape validator
  // doesn't reject the friendly-format string).
  const replyTarget = email.replyTo[0] || email.from;
  const replyAddress = extractAddress(replyTarget);
  const replySubject = email.subject.match(/^re:\s/i)
    ? email.subject
    : `Re: ${email.subject}`;
  const replyBody = email.text
    ? `\n\n\nOn ${formatTimestamp(email.createdAt)}, ${email.from} wrote:\n${quote(email.text)}`
    : "";

  return (
    <article className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/90 text-sm font-semibold text-background sm:h-11 sm:w-11"
            aria-hidden
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-base font-semibold leading-snug sm:text-lg">
              {email.subject}
            </h1>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{email.from}</span>{" "}
              → {email.to.join(", ") || "(no recipients)"}
            </p>
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              {formatTimestamp(email.createdAt)}
            </p>
          </div>
          {hasBothBodies && (
            <div
              className="hidden shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background p-0.5 sm:flex"
              role="tablist"
              aria-label="Body view"
            >
              <ToggleButton
                active={mode === "text"}
                onClick={() => setMode("text")}
                icon={FileText}
                label="Text"
              />
              <ToggleButton
                active={mode === "html"}
                onClick={() => setMode("html")}
                icon={Code2}
                label="HTML"
              />
            </div>
          )}
        </div>
        {hasBothBodies && (
          // Mobile body-switcher — full-width buttons under the
          // sender block. The desktop toggle hides on small screens.
          <div
            className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-border/60 bg-background p-0.5 sm:hidden"
            role="tablist"
            aria-label="Body view"
          >
            <ToggleButton
              active={mode === "text"}
              onClick={() => setMode("text")}
              icon={FileText}
              label="Text"
            />
            <ToggleButton
              active={mode === "html"}
              onClick={() => setMode("html")}
              icon={Code2}
              label="HTML"
            />
          </div>
        )}
      </header>

      <div className="flex items-center justify-end gap-2 border-b border-border/60 bg-muted/20 px-4 py-2 sm:px-5">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            haptic("tap");
            setReplyOpen(true);
          }}
          className="h-8 gap-1.5 coarse:h-11"
        >
          <Reply className="h-3.5 w-3.5" />
          Reply
        </Button>
      </div>

      <ComposeEmailDialog
        open={replyOpen}
        onOpenChange={setReplyOpen}
        initialTo={replyAddress}
        initialSubject={replySubject}
        initialBody={replyBody}
        inReplyTo={email.id}
      />

      <section className="px-4 py-4 sm:px-5">
        {mode === "text" ? (
          email.text ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-foreground/90">
              {email.text}
            </pre>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              No plain-text body in this message.
            </p>
          )
        ) : email.html ? (
          <iframe
            title="Email HTML body"
            srcDoc={email.html}
            // Sandbox without `allow-scripts` / `allow-same-origin`:
            // styles render, links are static, JavaScript / tracking
            // pixels / form posts are all disabled. The iframe is
            // size-stable via a fixed min-height; admin can scroll
            // within it if the message is long.
            sandbox=""
            className="min-h-[400px] w-full rounded-md border border-border/60 bg-white"
          />
        ) : (
          <p className="text-xs italic text-muted-foreground">
            No HTML body in this message.
          </p>
        )}
      </section>

      {attachments.length > 0 && (
        <section className="border-t border-border/60 px-4 py-3 sm:px-5">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Attachments ({attachments.length})
          </h2>
          <ul className="flex flex-wrap gap-2">
            {attachments.map((att) => (
              <li key={att.id}>
                <AttachmentChip attachment={att} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t border-border/60">
        <button
          type="button"
          onClick={() => setHeadersOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent/40 sm:px-5"
          aria-expanded={headersOpen}
        >
          {headersOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Headers ({Object.keys(email.headers).length})
        </button>
        {headersOpen && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 border-t border-border/60 bg-muted/30 px-4 py-3 font-mono text-[11px] sm:px-5">
            {Object.entries(email.headers).map(([k, v]) => (
              <div
                key={k}
                className="contents"
              >
                <dt className="truncate text-muted-foreground">{k}</dt>
                <dd className="break-all text-foreground/85">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </article>
  );
}

function ToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function AttachmentChip({ attachment }: { attachment: ReceivedAttachment }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs">
      <Paperclip className="h-3 w-3 text-muted-foreground" />
      <span className="font-medium">{attachment.filename}</span>
      <Badge
        variant="secondary"
        className="text-[9px] font-normal"
      >
        {attachment.contentType}
      </Badge>
      {attachment.size !== null && (
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatBytes(attachment.size)}
        </span>
      )}
      {/* Download intentionally not wired up — Resend's attachment
       *  GET returns the binary content, which means proxying through
       *  our route. Deferred until the operator confirms they need
       *  it; right now the read-only view satisfies the "see what
       *  came in" use case. */}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Pull the bare email out of an RFC 5322 address header. Handles
 *  the common shapes we see from Resend's inbound parser:
 *    - `"Display Name" <user@example.com>`  → user@example.com
 *    - `Display Name <user@example.com>`     → user@example.com
 *    - `user@example.com`                    → user@example.com
 *  Leaves the input alone if no angle brackets are present (the
 *  Resend payload sometimes contains just the bare address). */
function extractAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  if (m && m[1]) return m[1].trim();
  return raw.trim();
}

/** Prefix each line of `text` with `> ` for an email-style quote.
 *  Cap the quote length so a multi-megabyte original doesn't
 *  fill the compose window — operator can scroll the original
 *  in the detail view if they need more context. */
function quote(text: string): string {
  const cap = 2000;
  const slice =
    text.length > cap ? `${text.slice(0, cap)}\n[…truncated]` : text;
  return slice
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
