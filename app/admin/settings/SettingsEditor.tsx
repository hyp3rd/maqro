"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientFetch } from "@/lib/auth/client-fetch";
import { haptic } from "@/lib/haptics";
import { useState } from "react";
import { toast } from "sonner";

type Props = { initial: { supportInbox: string } };

/** Per-setting edit cards. Each field manages its own dirty state
 *  + a Save button so the operator can edit one value in isolation
 *  without a global "save all" hidden footer. */
export function SettingsEditor({ initial }: Props) {
  return (
    <div className="space-y-4">
      <SettingCard
        settingKey="support_inbox"
        title="Contact-form receiver"
        description="Where /api/support forwards every message sent via the public contact form. Must be a valid email address."
        initialValue={initial.supportInbox}
        inputType="email"
        placeholder="support@example.com"
      />
    </div>
  );
}

function SettingCard({
  settingKey,
  title,
  description,
  initialValue,
  inputType,
  placeholder,
}: {
  settingKey: string;
  title: string;
  description: string;
  initialValue: string;
  inputType?: "text" | "email" | "url";
  placeholder?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const dirty = value.trim() !== initialValue.trim();

  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      const res = await clientFetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: settingKey, value: value.trim() }),
      });
      if (!res.ok && res.status !== 204) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Couldn't save.");
        return;
      }
      haptic("success");
      toast.success("Saved. Propagates within ~60s.");
    } catch (err) {
      // A thrown fetch (network drop) skips the !res.ok branch above; without
      // this the operator gets no feedback and a silently-reset button.
      toast.error(
        err instanceof Error ? err.message : "Couldn't save — network error.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-card px-4 py-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {/* A form so Enter (or the mobile keyboard "Go") submits the value
          instead of only the Save button working. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="flex-1 space-y-1.5">
          <Label
            htmlFor={`setting-${settingKey}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Value
          </Label>
          <Input
            id={`setting-${settingKey}`}
            type={inputType ?? "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            placeholder={placeholder}
            autoComplete="off"
          />
        </div>
        <Button
          type="submit"
          disabled={busy || !dirty}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
    </section>
  );
}
