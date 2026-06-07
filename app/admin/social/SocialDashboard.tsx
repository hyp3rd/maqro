"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clientFetch } from "@/lib/auth/client-fetch";
import { lintTone } from "@/lib/social/tone";
import {
  PLATFORM_LABEL,
  PLATFORM_MAX_CHARS,
  SOCIAL_PLATFORMS,
  type SocialCampaign,
  type SocialPost,
} from "@/lib/social/types";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/** Fetch the release card as a blob and trigger a download. More robust than an
 *  `<a download>` (which the browser ignores cross-origin). */
async function downloadImage(url: string | null) {
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const id = new URL(url, window.location.origin).searchParams.get("id");
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `maqro-${id ?? "release-card"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    toast.error("Couldn't download the image.");
  }
}

export function SocialDashboard({
  campaigns,
  posts,
}: {
  campaigns: SocialCampaign[];
  posts: SocialPost[];
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);

  const byCampaign = new Map<string, SocialPost[]>();
  for (const p of posts) {
    const list = byCampaign.get(p.campaignId) ?? [];
    list.push(p);
    byCampaign.set(p.campaignId, list);
  }

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await clientFetch("/api/admin/social/generate", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.status === "created") toast.success("Drafted a new campaign.");
      else if (data.status === "exists")
        toast.info("The latest release is already drafted.");
      else if (data.status === "no-entry") toast.info("No changelog entry.");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't generate drafts.",
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Social posts</h1>
          <p className="text-sm text-muted-foreground">
            AI-drafted from the latest changelog entry. Review, edit, then post.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void generate()}
          disabled={generating}
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Generate now
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
          No campaigns yet. They appear automatically after a release adds a
          changelog entry, or use Generate now.
        </p>
      ) : (
        campaigns.map((c) => {
          const cposts = (byCampaign.get(c.id) ?? [])
            .slice()
            .sort(
              (a, b) =>
                SOCIAL_PLATFORMS.indexOf(a.platform) -
                SOCIAL_PLATFORMS.indexOf(b.platform),
            );
          return (
            <section
              key={c.id}
              className="space-y-3 rounded-lg border border-border/60 bg-card p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-sm font-semibold">{c.title}</h2>
                {c.version && (
                  <Badge
                    variant="secondary"
                    className="text-[10px]"
                  >
                    v{c.version}
                  </Badge>
                )}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {c.changelogId} · {c.createdAt.slice(0, 10)}
                </span>
              </div>
              <div className="space-y-3">
                {cposts.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function PostCard({ post }: { post: SocialPost }) {
  const max = PLATFORM_MAX_CHARS[post.platform];
  const [body, setBody] = useState(post.body);
  const [savedBody, setSavedBody] = useState(post.body);
  const [status, setStatus] = useState(post.status);
  const [busy, setBusy] = useState(false);

  const lint = lintTone(body, { maxLength: max });
  const dirty = body !== savedBody;
  const over = body.length > max;

  const save = async () => {
    setBusy(true);
    // Clean on save too — the reviewer's edits pass the same lint as the draft.
    const cleaned = lintTone(body, { maxLength: max }).text;
    try {
      const res = await clientFetch(`/api/admin/social/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: cleaned }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBody(cleaned);
      setSavedBody(cleaned);
      toast.success("Saved.");
    } catch {
      toast.error("Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast.success("Copied.");
    } catch {
      toast.error("Couldn't copy.");
    }
  };

  const markPosted = async () => {
    setBusy(true);
    try {
      const res = await clientFetch(
        `/api/admin/social/posts/${post.id}/publish`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("published");
      toast.success("Marked as posted.");
    } catch {
      toast.error("Couldn't update.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{PLATFORM_LABEL[post.platform]}</Badge>
          {status === "published" && (
            <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">
              Posted
            </Badge>
          )}
        </div>
        <span
          className={`font-mono text-[11px] tabular-nums ${
            over ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {body.length} / {max}
        </span>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={post.platform === "linkedin" ? 6 : 3}
        className="w-full resize-y rounded-md border border-border/60 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {lint.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {lint.warnings.map((w, i) => (
            <li
              key={i}
              className="text-[11px] text-amber-700 dark:text-amber-400"
            >
              {w}
            </li>
          ))}
        </ul>
      )}

      {post.platform === "instagram" && post.imageUrl && (
        <div className="mt-2 space-y-1.5">
          <a
            href={post.imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the full-size card"
            className="inline-block"
          >
            <Image
              src={post.imageUrl}
              alt="Release card"
              width={180}
              height={180}
              unoptimized
              className="cursor-zoom-in rounded-md border border-border/60 transition-opacity hover:opacity-90"
            />
          </a>
          <div className="flex items-center gap-3 text-[11px] font-medium">
            <a
              href={post.imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Open full size
            </a>
            <button
              type="button"
              onClick={() => void downloadImage(post.imageUrl)}
              className="text-primary hover:underline"
            >
              Download
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copy()}
        >
          Copy
        </Button>
        {dirty && (
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={busy}
          >
            Save
          </Button>
        )}
        {status !== "published" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void markPosted()}
            disabled={busy}
          >
            Mark posted
          </Button>
        )}
      </div>
    </div>
  );
}
