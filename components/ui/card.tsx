import { cn } from "@/lib/utils";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

/** Instrument panel: a hairline-bordered tier-1 surface. The shape the app
 *  hand-builds as `rounded-lg border border-border/60 bg-card` (and the
 *  `Section` shell in components/macro/FormFields.tsx).
 *
 *  `asChild` renders the caller's element instead of a `div`, so a panel can
 *  be a landmark (`<section aria-label>`), a list item or a link. */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      className={cn(
        "overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
});
Card.displayName = "Card";

/** Title row: the title block on the left, an optional action on the right
 *  (pass it as a second child). Separated from the body by a hairline. */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5",
      className,
    )}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

type HeadingLevel = "h2" | "h3" | "h4";

/** Panel title. Defaults to `h3`; pass `as` to fit the page outline. */
const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { as?: HeadingLevel }
>(({ className, as: Heading = "h3", ...props }, ref) => (
  <Heading
    ref={ref}
    className={cn("text-sm font-semibold text-foreground", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("mt-0.5 text-label text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("px-4 py-4 sm:px-5", className)}
    {...props}
  />
));
CardBody.displayName = "CardBody";

export { Card, CardBody, CardDescription, CardHeader, CardTitle };
