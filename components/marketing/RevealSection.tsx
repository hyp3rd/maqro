"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

type Props = {
  children: ReactNode;
  className?: string;
  id?: string;
  /** ARIA landmark label, if the section deserves one. */
  ariaLabel?: string;
};

/** Scroll-triggered fade + lift wrapper for marketing-landing
 *  sections. Renders a real `<section>` so semantics + landmark
 *  navigation stay intact. The animation re-fires every time the
 *  section enters the viewport — the observer stays attached so
 *  scrolling up and down keeps the page alive.
 *
 *  We tried a pure CSS approach with `animation-timeline: view()`
 *  first — it should be a perfect fit, but in practice it didn't
 *  fire in our setup (Tailwind 4 layer interactions, mobile
 *  Safari quirks). Motion's `whileInView` is reliable and adds
 *  only the wrapper to the client bundle; the section content
 *  itself still renders on the server and arrives as children.
 *
 *  `prefers-reduced-motion` is respected by Motion automatically:
 *  users with that preference jump straight to the visible state. */
export function RevealSection({ children, className, id, ariaLabel }: Props) {
  return (
    <motion.section
      id={id}
      aria-label={ariaLabel}
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      // `once: false` — animation re-fires every time the section
      // enters the viewport. Motion animates back to `initial`
      // when the section leaves; that "out" transition happens
      // while the section is off-screen, so the user only sees
      // the fade-in side of the cycle. Result: the page feels
      // alive on every scroll up + down without the dizzying
      // re-trigger you'd get from animating elements that are
      // already visible.
      //
      // `margin` shifts the trigger boundary up 10 % so animation
      // begins just before the section is fully on screen rather
      // than after — reads as "the section arrives" instead of
      // "the section was already there."
      viewport={{ once: false, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.55, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </motion.section>
  );
}
