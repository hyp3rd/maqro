import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge only infers t-shirt names (`2xs`, `3xs`) as font sizes, so
 *  any other size from `theme.extend.fontSize` in tailwind.config.mjs must be
 *  registered here. Otherwise `text-label` is filed as a text colour and
 *  dropped next to `text-muted-foreground`. utils.test.ts checks that every
 *  configured size is covered. */
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["label"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
