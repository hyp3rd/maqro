"use client";

import { type ReadoutDecimals, formatNumber } from "@/lib/i18n/number";
import * as React from "react";
import {
  animate,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { motion } from "motion/react";
import { useLocale } from "next-intl";

type Props = {
  value: number;
  /** Decimals to display. Default 0. */
  decimals?: ReadoutDecimals;
  /** Animation duration in seconds. */
  duration?: number;
  /** Optional prefix (e.g. "+", "-"). */
  prefix?: string;
  /** Optional suffix (e.g. " kcal", " g"). */
  suffix?: string;
  className?: string;
};

/** Animates the displayed number toward `value` on each change. Spring-y
 * but quick. Uses tabular-nums so digits don't dance. Every frame is
 * formatted like the other readouts (`formatNumber`: the app locale's
 * grouping and decimal mark), so a ticker never reads "1950" beside a
 * "1,950". */
export function NumberTicker({
  value,
  decimals = 0,
  duration = 0.5,
  prefix = "",
  suffix = "",
  className,
}: Props) {
  const mv = useMotionValue(value);
  const reduceMotion = useReducedMotion();
  const locale = useLocale();
  const rounded = useTransform(
    mv,
    (v) => `${prefix}${formatNumber(v, locale, decimals)}${suffix}`,
  );

  React.useEffect(() => {
    // Respect prefers-reduced-motion: snap to the value instead of counting up.
    // Motion's animate() doesn't honor the preference on its own.
    if (reduceMotion) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, {
      duration,
      ease: [0.16, 1, 0.3, 1], // ease-out-expo-ish
    });
    return () => controls.stop();
  }, [value, duration, mv, reduceMotion]);

  return <motion.span className={className}>{rounded}</motion.span>;
}
