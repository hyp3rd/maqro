"use client";

import { cn } from "@/lib/utils";
import { useId, useRef, useState } from "react";
import { X } from "lucide-react";

type Props = {
  /** Current tag list (parent owns the source of truth). */
  value: string[];
  /** Fires with the new list when a tag is added or removed. */
  onChange: (next: string[]) => void;
  /** Placeholder shown only when the input is empty AND no tags exist. */
  placeholder?: string;
  /** Optional id forwarded to the inner input so a sibling <Label
   *  htmlFor> can reference it for accessibility. */
  id?: string;
  /** ARIA label fallback when no associated <Label> exists. */
  "aria-label"?: string;
};

/** Controlled tag-style input. Commits the typed buffer to the tag list on:
 *   - Enter
 *   - comma (`,`)
 *   - blur (only if non-empty)
 *
 *  Backspace on an empty buffer pops the last tag. Click the × on a tag
 *  to remove it. Whitespace inside a tag is preserved ("peanut butter"
 *  is one tag); duplicate adds (case-insensitive) are ignored so the
 *  same allergen can't sneak in twice. */
export function TagInput({
  value,
  onChange,
  placeholder,
  id,
  "aria-label": ariaLabel,
}: Props) {
  const [buffer, setBuffer] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    // Case-insensitive dedup — most users would call "Peanuts" and
    // "peanuts" the same allergy and be surprised by both surviving.
    const lower = trimmed.toLowerCase();
    if (value.some((v) => v.toLowerCase() === lower)) {
      setBuffer("");
      return;
    }
    onChange([...value, trimmed]);
    setBuffer("");
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(buffer);
      return;
    }
    if (e.key === "Backspace" && buffer === "" && value.length > 0) {
      e.preventDefault();
      // Pop the trailing tag, but pull its text back into the buffer
      // so the user can finish editing instead of being silently
      // deleted. Standard tag-input behaviour.
      const last = value[value.length - 1];
      onChange(value.slice(0, -1));
      setBuffer(last);
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      role="presentation"
      className={cn(
        "flex min-h-9 cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm transition-colors",
        focused ? "ring-1 ring-ring" : "hover:border-input/80",
      )}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="group inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted px-2 py-0.5 text-xs"
        >
          <span>{tag}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(i);
            }}
            className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${tag}`}
            title={`Remove ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id ?? inputId}
        type="text"
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          // Commit on blur so a tag the user typed without pressing
          // Enter still lands in the list. Common UX expectation.
          if (buffer) commit(buffer);
        }}
        placeholder={value.length === 0 ? placeholder : undefined}
        aria-label={ariaLabel}
        className="min-w-[8ch] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
