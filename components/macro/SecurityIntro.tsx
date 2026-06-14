"use client";

import { useDisplayName } from "@/hooks/use-display-name";
import { ShieldCheck } from "lucide-react";
import { FeatureIntro } from "./FeatureIntro";

/** One consolidated explainer for the whole Security group, replacing the three
 *  per-section intros (two-step / passkeys / backup email) that used to stack
 *  above each card. Sits at the top of the group next to the status overview.
 *  Dismissible per device, like the originals. */
export function SecurityIntro() {
  const displayName = useDisplayName();
  return (
    <FeatureIntro
      storageKey="security"
      icon={ShieldCheck}
      tint="amber"
      displayName={displayName}
      blurb="your account is protected by your sign-in email — and you can add more below. Two-step verification asks for a 6-digit code from an authenticator app (set it up once; we only ask again on a new device); passkeys let you sign in with Face ID, Touch ID, or a hardware key, no code to type; and a backup email means you can always recover access if you lose your primary inbox."
    />
  );
}
