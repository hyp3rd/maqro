"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

/** Motion's default is `reducedMotion: "never"`, so JS-driven animations
 *  (view fades, nav indicators, sheets, whileInView reveals) ignored the OS
 *  "reduce motion" setting; the CSS rule in globals.css only covers CSS
 *  animations. `"user"` makes every descendant `motion` component skip
 *  transform and layout animation when the user asked for less motion,
 *  while opacity and colour still animate. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
