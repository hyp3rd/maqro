import type { ChangelogEntry } from "@/lib/changelog";

/** Single changelog list item — date / version chip / title / body.
 *  Pure JSX, no state, used from BOTH the server-rendered page
 *  ([app/changelog/page.tsx](../../app/changelog/page.tsx)) and the
 *  client-side "Show more" tail ([ChangelogTail.tsx](./ChangelogTail.tsx)).
 *
 *  Keeping it in its own file (no `"use client"`) means it can be
 *  consumed from either side without the directive ambiguity that
 *  comes with inlining the component in the page file. */
export function EntryItem({ entry }: { entry: ChangelogEntry }) {
  return (
    <li className="border-l-2 border-border/60 pl-5">
      <header className="mb-3 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <time
            dateTime={entry.date}
            className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            {entry.date}
          </time>
          {entry.version && (
            <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80">
              v{entry.version}
            </span>
          )}
        </div>
        <h2 className="text-base font-semibold tracking-tight">
          {entry.title}
        </h2>
      </header>
      <EntryBody body={entry.body} />
    </li>
  );
}

/** Render entry body. Split on double-newline for paragraphs, and
 *  group lines that start with "- " into a bulleted list. This is
 *  the lightest-touch renderer that handles the two layout shapes
 *  the entries actually use; anything richer is a sign we should
 *  reach for MDX instead. */
function EntryBody({ body }: { body: string }) {
  const blocks = body.split(/\n\s*\n/);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground/85">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const isBulletBlock = lines.every(
          (l) => l.trim().startsWith("- ") || l.trim().length === 0,
        );
        if (isBulletBlock) {
          const items = lines
            .map((l) => l.trim().replace(/^-\s+/, ""))
            .filter((l) => l.length > 0);
          return (
            <ul
              key={i}
              className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground/60"
            >
              {items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{block}</p>;
      })}
    </div>
  );
}
