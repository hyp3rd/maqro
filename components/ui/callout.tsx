import { cn } from "@/lib/utils";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
  OctagonAlert,
} from "lucide-react";

/** Inline message block. The tone tints the border and background and
 *  colours the icon; the copy always stays in the foreground colour, since
 *  tone-coloured text on its own tint misses 4.5:1 in light mode.
 *
 *  Tones describe the SYSTEM (saved, offline, failed, needs attention). They
 *  are never a verdict on intake against a target: over/under stays neutral,
 *  and the copy stays calm and factual ("Couldn't save. Your changes are kept
 *  on this device."), never alarming or preachy.
 *
 *  Static by default. Pass `role="status"` (polite) or `role="alert"` when
 *  the message appears in response to something the user did. */
const calloutVariants = cva(
  "flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-5 text-foreground",
  {
    variants: {
      tone: {
        neutral: "border-border/60 bg-muted",
        info: "border-info/30 bg-info/5",
        success: "border-success/30 bg-success/5",
        warning: "border-warning/30 bg-warning/5",
        destructive: "border-destructive/30 bg-destructive/5",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

type Tone = NonNullable<VariantProps<typeof calloutVariants>["tone"]>;

const TONE_ICON: Record<Tone, { Icon: LucideIcon; className: string }> = {
  neutral: { Icon: Info, className: "text-muted-foreground" },
  info: { Icon: Info, className: "text-info" },
  success: { Icon: CheckCircle2, className: "text-success" },
  warning: { Icon: AlertTriangle, className: "text-warning" },
  destructive: { Icon: OctagonAlert, className: "text-destructive" },
};

export interface CalloutProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof calloutVariants> {
  /** Short heading above the body copy. */
  title?: React.ReactNode;
  /** Replaces the tone's icon; `null` drops it. */
  icon?: React.ReactNode;
}

const Callout = React.forwardRef<HTMLDivElement, CalloutProps>(
  ({ className, tone, title, icon, children, ...props }, ref) => {
    const resolved = TONE_ICON[tone ?? "neutral"];
    const glyph =
      icon === undefined ? (
        <resolved.Icon
          aria-hidden
          className={cn("mt-0.5 h-4 w-4 shrink-0", resolved.className)}
        />
      ) : (
        icon
      );
    return (
      <div
        ref={ref}
        className={cn(calloutVariants({ tone }), className)}
        {...props}
      >
        {glyph}
        <div className="min-w-0 flex-1 space-y-0.5">
          {title !== undefined && <p className="font-medium">{title}</p>}
          {/* Under a title the body steps down to secondary text. */}
          <div className={title !== undefined ? "text-muted-foreground" : ""}>
            {children}
          </div>
        </div>
      </div>
    );
  },
);
Callout.displayName = "Callout";

export { Callout, calloutVariants };
