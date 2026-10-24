import { cn } from "@/lib/utils";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";

const buttonVariants = cva(
  // `transition-[…transform]` + `coarse:active:scale` give a subtle
  // tactile press on touch (the button dips ~3% under the finger and
  // springs back). Gated to coarse pointers so the desktop keeps its
  // crisp hover/active colour states with no movement.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 coarse:active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive-strong text-destructive-foreground hover:bg-destructive-strong/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Brand-filled CTA. `brand-strong` is the fill that keeps the white
        // label >= 4.5:1 in both themes (raw `brand` does not in dark).
        brand: "bg-brand-strong text-brand-foreground hover:bg-brand-strong/90",
      },
      // `touch-N` = `h-N` on a precise pointer and >= 44px on a finger
      // (tailwind.config.mjs), so every size is a real touch target on
      // phones without inflating the dense desktop layout. A call site's
      // plain `h-*` override replaces the touch size outright.
      size: {
        default: "h-touch-10 px-4 py-2",
        xs: "h-touch-7 gap-1.5 rounded-md px-2.5 text-xs",
        sm: "h-touch-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-11 w-11",
        "icon-sm": "h-touch-8 w-touch-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
