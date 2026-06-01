"use client";

import * as React from "react";
import { animate, useMotionValue, useTransform } from "motion/react";
import { motion } from "motion/react";

type Props = {
  value: number;
  /** Decimals to display. Default 0. */
  decimals?: number;
  /** Animation duration in seconds. */
  duration?: number;
  /** Optional prefix (e.g. "+", "-"). */
  prefix?: string;
  /** Optional suffix (e.g. " kcal", " g"). */
  suffix?: string;
  className?: string;
};

/** Animates the displayed number toward `value` on each change. Spring-y
 * but quick. Uses tabular-nums so digits don't dance. */
export function NumberTicker({
  value,
  decimals = 0,
  duration = 0.5,
  prefix = "",
  suffix = "",
  className,
}: Props) {
  const mv = useMotionValue(value);
  const rounded = useTransform(mv, (v) => {
    const n = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toString();
    return `${prefix}${n}${suffix}`;
  });

  React.useEffect(() => {
    const controls = animate(mv, value, {
      duration,
      ease: [0.16, 1, 0.3, 1], // ease-out-expo-ish
    });
    return () => controls.stop();
  }, [value, duration, mv]);

  return <motion.span className={className}>{rounded}</motion.span>;
}
