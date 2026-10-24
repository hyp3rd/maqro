"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { Check } from "lucide-react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    // On a finger the box grows to 20px and an invisible ::after, sized to
    // `--touch-target-min` (44px on coarse pointers) and centred on the box,
    // forms the hit area without taking layout space. It is sized and
    // centred rather than inset because an absolute ::after is placed
    // against the padding box (20px minus the 1px border = 18px), so an
    // inset would come up short by twice the border width. It reaches
    // 12px past the box on every side. A precise pointer keeps the 16px
    // box and no extra hit area.
    className={cn(
      "peer relative h-4 w-4 shrink-0 rounded-sm border coarse:h-5 coarse:w-5 coarse:after:absolute coarse:after:left-1/2 coarse:after:top-1/2 coarse:after:size-(--touch-target-min) coarse:after:-translate-1/2 border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
