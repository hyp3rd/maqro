"use client";

import { useElementWidth } from "@/hooks/use-element-width";
import { usePrinting } from "@/hooks/use-printing";
import {
  type DayTick,
  dayTicks,
  formatDayIndex,
  layoutBars,
  linearPath,
  monotonePath,
  niceTicks,
  type Pt,
  stepPath,
  xUnit,
} from "@/lib/charts/geometry";
import { cn } from "@/lib/utils";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type LinePoint = {
  /** Numeric x value. With `xType="day"` this is a calendar-day index
   *  (`dayIndexFromIsoDate` in lib/charts/geometry.ts). */
  x: number;
  y: number;
  /** Optional human label, used for x-axis labels when `xType="number"`. */
  label?: string;
  /** Optional human label for the tooltip and data table. Falls back to
   *  `label`, then the formatted date (day series) or raw `x`. */
  tooltipLabel?: string;
};

/** One point of a per-x target series (e.g. a day's calorie target). */
export type TargetPoint = { x: number; y: number };

/** A vertical annotation drawn across the plot — e.g. a goal-phase boundary. */
export type ChartMarker = {
  /** Position in the same x-space as the data points. Markers outside the
   *  data's x-range are skipped. */
  x: number;
  /** Short label drawn at the top of the line (e.g. "Cut", "Diet break"). */
  label?: string;
};

type Props = {
  data: LinePoint[];
  /** Drawing width used until the container has been measured (server
   *  render, no ResizeObserver) and while printing. Otherwise the chart
   *  draws at the container's real width. */
  width?: number;
  /** Height in CSS pixels. */
  height?: number;
  /** Force the y axis to include 0; useful for some metrics, off for
   *  weight. Bar charts always include 0. */
  yIncludeZero?: boolean;
  /** Upper bound on the number of x-axis labels. The chart already fits as
   *  many as the measured width allows; this only caps it further. */
  xTicks?: number;
  /** Unit of the y values (e.g. " kg"). Shown once above the y axis and
   *  after values in the tooltip, summary and table. */
  yUnit?: string;
  /** `"day"`: x values are calendar-day indices, and the x axis gets
   *  evenly spaced date labels (daily, Mondays or month starts). `"number"`
   *  (default): x is any number, labelled from each point's `label`. */
  xType?: "number" | "day";
  /** `"bar"` draws one bar per x unit (daily totals) from zero; any part
   *  past that point's target is drawn in the same hue at lower intensity
   *  with a neutral "+N". */
  variant?: "line" | "bar";
  /** Optional single horizontal reference line (e.g. a flat calorie
   *  target), dashed. */
  targetY?: number;
  /** Optional per-x targets, drawn as a step line (a level per day). Where
   *  a point has a series entry it beats `targetY` for that point's
   *  overshoot, tooltip and table. */
  targetSeries?: TargetPoint[];
  /** Short text labelling the reference: the `targetY` line when set,
   *  otherwise the step series. */
  targetLabel?: string;
  /** Monotone cubic smoothing (never overshoots the data). Default off:
   *  straight segments are the honest default for daily data. */
  smooth?: boolean;
  /** Optional vertical markers (e.g. goal-phase boundaries) drawn as thin
   *  dashed lines with a short top label, under the data line. */
  markers?: ChartMarker[];
  /** x of "today / now", drawn in the signal colour. */
  highlightX?: number;
  /** What the chart shows ("Weight"), used in its accessible summary and
   *  as the data table's caption. */
  title?: string;
};

/** Text metrics. Labels use `text-xs` (12px) Geist Mono, whose glyphs
 *  advance about 0.6em, so label widths are estimated from character
 *  counts instead of measuring DOM text (which would need a second layout
 *  pass per render). Used for gutter sizing and label spacing only. */
const FONT_PX = 12;
const MONO_CHAR_PX = FONT_PX * 0.6;
const PAD = { top: 24, right: 12, bottom: 26 } as const;
/** Minimum vertical room per y interval, px. */
const Y_INTERVAL_PX = 44;
/** Gap kept between neighbouring x labels, px. */
const X_LABEL_GAP_PX = 14;

const monoWidth = (s: string) => s.length * MONO_CHAR_PX;

/** Visible text of the data-table disclosure, and the start of its name. */
const TABLE_TOGGLE = "Show data table";

/** Lightweight line / bar chart in pure SVG, drawn at the container's real
 *  pixel width (so labels are true-size on phones). No charting library:
 *  ticks, paths and bar layout come from lib/charts/geometry.ts.
 *
 *  Returns null if `data` is empty — the caller renders the empty state. */
export function MiniLineChart({
  data,
  width = 640,
  height = 220,
  yIncludeZero = false,
  xTicks,
  yUnit = "",
  xType = "number",
  variant = "line",
  targetY,
  targetSeries,
  targetLabel,
  smooth = false,
  markers = [],
  highlightX,
  title,
}: Props) {
  const gradientId = useId();
  const [wrapRef, measured] = useElementWidth<HTMLDivElement>();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // A tapped tooltip stays up after the finger lifts (there's no hover on
  // touch), so a tap anywhere outside the chart is what puts it away.
  const tooltipShown = activeIndex !== null;
  useEffect(() => {
    if (!tooltipShown) return undefined;
    function onPointerDown(e: PointerEvent) {
      const svgEl = svgRef.current;
      if (svgEl && e.target instanceof Node && svgEl.contains(e.target)) {
        return;
      }
      setActiveIndex(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [tooltipShown]);

  // Print layout never reaches the ResizeObserver in time, so a chart last
  // measured on a phone would print at phone width, centred with empty
  // bands. While printing, draw at `width` and let the SVG scale to the
  // printed column (height follows the viewBox; see the <svg> below).
  const printing = usePrinting();
  const W = Math.max(120, printing ? width : (measured ?? width));
  const H = Math.max(80, height);
  const unit = yUnit.trim();
  const isBar = variant === "bar";

  // Sorted copies: every path builder below assumes ascending x.
  const points = useMemo(() => [...data].sort((a, b) => a.x - b.x), [data]);
  const targets = useMemo(
    () => [...(targetSeries ?? [])].sort((a, b) => a.x - b.x),
    [targetSeries],
  );

  const numberFmt = useMemo(
    () => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }),
    [],
  );
  const fmtValue = (v: number) => numberFmt.format(v);
  const withUnit = (v: number) => `${fmtValue(v)}${yUnit}`;

  const chart = useMemo(() => {
    if (points.length === 0) return null;
    const targetAt = (x: number) =>
      targets.find((t) => t.x === x)?.y ?? targetY;
    const fmtNum = (n: number) => numberFmt.format(n);
    const xs = points.map((p) => p.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const inRange = targets.filter((t) => t.x >= xMin && t.x <= xMax);

    // --- y scale -------------------------------------------------------
    const ys = points.map((p) => p.y);
    if (targetY !== undefined) ys.push(targetY);
    for (const t of inRange) ys.push(t.y);
    if (yIncludeZero || isBar) ys.push(0);
    const innerH = H - PAD.top - PAD.bottom;
    const scale = niceTicks(
      Math.min(...ys),
      Math.max(...ys),
      Math.max(2, Math.floor(innerH / Y_INTERVAL_PX)),
    );
    const tickFmt = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: scale.decimals,
      maximumFractionDigits: scale.decimals,
    });
    const yTicks = scale.ticks.map((v) => ({ v, label: tickFmt.format(v) }));
    // Left gutter sized to the widest tick label (right-anchored text grows
    // leftward from it), floored for a tidy axis, capped so a pathological
    // value can't swallow the plot.
    const left = Math.min(
      96,
      Math.max(
        28,
        Math.ceil(Math.max(...yTicks.map((t) => monoWidth(t.label)))) + 10,
      ),
    );
    const innerW = Math.max(1, W - left - PAD.right);
    const ySpan = scale.max - scale.min || 1;
    const yToPx = (y: number) =>
      PAD.top + (1 - (y - scale.min) / ySpan) * innerH;
    const baseline = PAD.top + innerH;

    // --- x scale -------------------------------------------------------
    // A day axis has a known unit: one calendar day. Inferring it from the
    // data would make every slot two days wide for an every-other-day log,
    // hiding the unlogged days the slots exist to show.
    const step = xType === "day" ? 1 : xUnit(xs);
    const bars = isBar
      ? layoutBars(
          points.map((p) => ({ x: p.x, value: p.y, target: targetAt(p.x) })),
          {
            left,
            width: innerW,
            yToPx,
            baselinePx: yToPx(Math.max(scale.min, Math.min(0, scale.max))),
            unit: step,
          },
        )
      : null;
    const xSpan = xMax - xMin;
    const xToPx = bars
      ? bars.xToPx
      : (x: number) =>
          xSpan === 0
            ? left + innerW / 2
            : left + ((x - xMin) / xSpan) * innerW;
    // Pixels per x unit: a bar slot, or the gap between consecutive days.
    const unitPx = bars
      ? bars.slotWidth
      : xSpan === 0
        ? innerW
        : (step / xSpan) * innerW;

    // --- x labels ------------------------------------------------------
    type XLabel = { x: number; text: string };
    // Places labels left to right, each centred on its x but clamped inside
    // the SVG so an edge label never clips, and skips any that would crowd
    // the one before it or pass the `xTicks` cap.
    const cap = xTicks ?? Infinity;
    const layoutLabels = (labels: readonly XLabel[]) => {
      const placed: { px: number; text: string }[] = [];
      let dropped = false;
      let lastRight = -Infinity;
      for (const c of labels) {
        const w = monoWidth(c.text);
        const px = Math.min(Math.max(xToPx(c.x), w / 2), W - w / 2);
        if (px - w / 2 < lastRight + X_LABEL_GAP_PX || placed.length >= cap) {
          dropped = true;
          continue;
        }
        placed.push({ px, text: c.text });
        lastRight = px + w / 2;
      }
      return { placed, dropped };
    };
    const toXLabels = (ticks: readonly DayTick[]): XLabel[] =>
      ticks.map((t) => ({ x: t.day, text: t.label }));
    // A day step fits only when none of its labels would be skipped (the
    // edge clamp included), so the labels drawn keep one even step.
    const candidates: XLabel[] =
      xType === "day"
        ? toXLabels(
            dayTicks(
              xMin,
              xMax,
              (ticks) => !layoutLabels(toXLabels(ticks)).dropped,
            ),
          )
        : points.map((p) => ({ x: p.x, text: p.label ?? fmtNum(p.x) }));
    const xLabels = layoutLabels(candidates).placed;

    // --- paths ---------------------------------------------------------
    const pts: Pt[] = points.map((p) => ({ x: xToPx(p.x), y: yToPx(p.y) }));
    const linePath = isBar ? "" : smooth ? monotonePath(pts) : linearPath(pts);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const areaPath =
      !isBar && first && last
        ? `${linePath} L${last.x},${baseline} L${first.x},${baseline} Z`
        : "";
    const stepPts = inRange.map((t) => ({ x: xToPx(t.x), y: yToPx(t.y) }));
    const stepFirst = stepPts[0];
    const stepLast = stepPts[stepPts.length - 1];
    const targetStepPath =
      stepFirst && stepLast
        ? stepPath(stepPts, {
            left: Math.max(left, stepFirst.x - unitPx / 2),
            right: Math.min(left + innerW, stepLast.x + unitPx / 2),
          })
        : "";

    return {
      xMin,
      xMax,
      left,
      innerW,
      innerH,
      baseline,
      yToPx,
      xToPx,
      yTicks,
      xLabels,
      bars,
      pts,
      linePath,
      areaPath,
      targetStepPath,
      stepFirstY: stepFirst?.y,
      targetsInRange: inRange,
    };
  }, [
    points,
    targets,
    targetY,
    yIncludeZero,
    isBar,
    H,
    W,
    xType,
    xTicks,
    smooth,
    numberFmt,
  ]);

  if (!chart) return null;

  const targetFor = (x: number) => targets.find((t) => t.x === x)?.y ?? targetY;
  const labelFor = (p: LinePoint) =>
    p.tooltipLabel ??
    p.label ??
    (xType === "day" ? formatDayIndex(p.x) : fmtValue(p.x));

  // --- accessible summary ------------------------------------------------
  const ys = points.map((p) => p.y);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  // Only the targets inside the plotted range, as the step line draws them:
  // a series that runs past the data must not widen the summary's range.
  const shownTargets = chart.targetsInRange;
  const hasTargets = targetY !== undefined || shownTargets.length > 0;
  const summary = (() => {
    if (!firstPoint || !lastPoint) return "";
    const n = points.length;
    const kind = isBar ? "Bar chart" : "Line chart";
    const span =
      n === 1
        ? `1 entry on ${labelFor(firstPoint)}`
        : `${n} entries from ${labelFor(firstPoint)} to ${labelFor(lastPoint)}`;
    let s = `${title ? `${title}. ` : ""}${kind}, ${span}. Lowest ${withUnit(Math.min(...ys))}, highest ${withUnit(Math.max(...ys))}, latest ${withUnit(lastPoint.y)}.`;
    if (targetY !== undefined) s += ` Target ${withUnit(targetY)}.`;
    if (shownTargets.length > 0) {
      const tys = shownTargets.map((t) => t.y);
      const lo = Math.min(...tys);
      const hi = Math.max(...tys);
      s +=
        lo === hi
          ? ` Daily target ${withUnit(lo)}.`
          : ` Daily targets from ${withUnit(lo)} to ${withUnit(hi)}.`;
    }
    return s;
  })();

  // --- pointer → nearest point ------------------------------------------
  function pointerToIndex(
    svg: SVGSVGElement,
    clientX: number,
    clientY: number,
  ): number {
    if (!chart) return -1;
    // Map screen → user space. getScreenCTM accounts for any CSS transform
    // on an ancestor (the fullscreen viewer rotates and pinch-scales the
    // chart); the bounding-rect fallback covers environments without it.
    let x: number;
    const ctm = svg.getScreenCTM?.();
    if (ctm) {
      const inv = ctm.inverse();
      x = inv.a * clientX + inv.c * clientY + inv.e;
    } else {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return -1;
      x = ((clientX - rect.left) / rect.width) * W;
    }
    if (x < chart.left || x > chart.left + chart.innerW) return -1;
    let best = 0;
    let bestDist = Infinity;
    chart.pts.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  const active = activeIndex !== null ? points[activeIndex] : undefined;
  const activePt = activeIndex !== null ? chart.pts[activeIndex] : undefined;

  const visibleMarkers = markers.filter(
    (m) => m.x >= chart.xMin && m.x <= chart.xMax,
  );
  const plotRight = chart.left + chart.innerW;
  const targetLinePx = targetY !== undefined ? chart.yToPx(targetY) : undefined;
  // The reference label starts at the plot's left edge (the top-right
  // corner belongs to the expand button), above its line unless that
  // would leave the plot, with a card-coloured halo so it stays legible
  // over bars and lines.
  const labelY = targetLinePx ?? chart.stepFirstY;
  const labelBelow = labelY !== undefined && labelY - PAD.top < 16;

  return (
    <div
      ref={wrapRef}
      className="w-full text-foreground"
    >
      <svg
        ref={svgRef}
        width="100%"
        height={printing ? undefined : H}
        viewBox={`0 0 ${W} ${H}`}
        className="block overflow-visible"
        role="img"
        aria-label={summary}
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor="currentColor"
              stopOpacity="0.14"
            />
            <stop
              offset="100%"
              stopColor="currentColor"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>

        {/* Unit, once, above the y labels. */}
        {unit && (
          <text
            x={chart.left - 8}
            y={PAD.top - 12}
            textAnchor="end"
            className="fill-faint-foreground text-xs"
          >
            {unit}
          </text>
        )}

        {/* Horizontal gridlines + y-axis labels. */}
        {chart.yTicks.map(({ v, label }) => {
          const y = chart.yToPx(v);
          return (
            <g key={label}>
              <line
                x1={chart.left}
                x2={plotRight}
                y1={y}
                y2={y}
                className="stroke-border/60"
                strokeWidth={1}
              />
              <text
                x={chart.left - 8}
                y={y}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground font-mono text-xs tabular-nums"
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* X-axis labels: evenly spaced, clamped inside the chart. */}
        {chart.xLabels.map((l) => (
          <text
            key={`x-${l.px}`}
            x={l.px}
            y={chart.baseline + 18}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-xs tabular-nums"
          >
            {l.text}
          </text>
        ))}

        {/* Vertical markers (e.g. goal-phase boundaries), under the data. */}
        {visibleMarkers.map((m, i) => {
          const mx = chart.xToPx(m.x);
          const anchor =
            mx <= chart.left + chart.innerW * 0.15
              ? "start"
              : mx >= chart.left + chart.innerW * 0.85
                ? "end"
                : "middle";
          return (
            <g key={`marker-${i}`}>
              <line
                x1={mx}
                x2={mx}
                y1={PAD.top}
                y2={chart.baseline}
                className="stroke-foreground/25"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              {m.label && (
                <text
                  x={mx}
                  y={PAD.top + 12}
                  textAnchor={anchor}
                  className="fill-muted-foreground text-xs"
                >
                  {m.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Bars: solid to the target, the same hue fainter past it. */}
        {chart.bars?.bars.map((b) => {
          const p = points[b.index];
          const today = p !== undefined && p.x === highlightX;
          const overText = b.over ? `+${fmtValue(b.over.amount)}` : "";
          const radius = Math.min(2, b.width / 4);
          const showOverText =
            b.over !== undefined &&
            chart.bars !== null &&
            chart.bars.slotWidth >= monoWidth(overText) + 4;
          return (
            <g key={`bar-${b.index}`}>
              {/* The faint full-height bar goes underneath and the solid
                  part over it, so the bar reads as one continuous shape
                  that simply gets lighter past the target. */}
              {b.over && (
                <rect
                  data-part="bar-over"
                  x={b.left}
                  y={b.over.top}
                  width={b.width}
                  height={Math.max(0, b.base.bottom - b.over.top)}
                  rx={radius}
                  className={today ? "fill-signal/30" : "fill-foreground/25"}
                />
              )}
              <rect
                data-part="bar"
                x={b.left}
                y={b.base.top}
                width={b.width}
                height={Math.max(0, b.base.bottom - b.base.top)}
                rx={b.over ? 0 : radius}
                className={today ? "fill-signal" : "fill-foreground/70"}
              />
              {b.over && showOverText && (
                <text
                  x={b.cx}
                  y={b.over.top - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono text-xs tabular-nums"
                >
                  {overText}
                </text>
              )}
            </g>
          );
        })}

        {/* Target: single dashed line and/or per-day step line. */}
        {targetLinePx !== undefined && (
          <line
            data-part="target-line"
            x1={chart.left}
            x2={plotRight}
            y1={targetLinePx}
            y2={targetLinePx}
            className="stroke-foreground/50"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {chart.targetStepPath && (
          <path
            data-part="target-step"
            d={chart.targetStepPath}
            fill="none"
            className="stroke-foreground/60"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        )}
        {targetLabel && labelY !== undefined && (
          <text
            x={chart.left + 4}
            y={labelBelow ? labelY + 16 : labelY - 6}
            textAnchor="start"
            className="fill-muted-foreground stroke-card text-xs"
            strokeWidth={4}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {targetLabel}
          </text>
        )}

        {!isBar && (
          <>
            <path
              d={chart.areaPath}
              fill={`url(#${gradientId})`}
              stroke="none"
            />
            <path
              data-part="line"
              d={chart.linePath}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {chart.pts.map((p, i) => {
              const today = points[i]?.x === highlightX;
              return (
                <circle
                  key={`dot-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={today ? 3.5 : 2}
                  className={today ? "fill-signal" : undefined}
                  fill={today ? undefined : "currentColor"}
                />
              );
            })}
          </>
        )}

        {/* Hover crosshair + tooltip, on top of everything. */}
        {active && activePt && (
          <g pointerEvents="none">
            <line
              x1={activePt.x}
              x2={activePt.x}
              y1={PAD.top}
              y2={chart.baseline}
              className="stroke-foreground/30"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            {!isBar && (
              <circle
                cx={activePt.x}
                cy={activePt.y}
                r={4}
                className="fill-background stroke-foreground"
                strokeWidth={1.5}
              />
            )}
            {(() => {
              const t = targetFor(active.x);
              const text = `${labelFor(active)} · ${withUnit(active.y)}${
                t !== undefined ? ` · target ${fmtValue(t)}` : ""
              }`;
              const tooltipW = Math.min(W - 8, monoWidth(text) + 16);
              const tooltipH = 24;
              const goLeft = activePt.x + tooltipW + 10 > plotRight;
              const rectX = Math.max(
                0,
                goLeft ? activePt.x - tooltipW - 10 : activePt.x + 10,
              );
              const rectY =
                activePt.y - tooltipH - 6 < 0
                  ? activePt.y + 12
                  : activePt.y - tooltipH - 6;
              return (
                <g>
                  <rect
                    x={rectX}
                    y={Math.min(rectY, H - tooltipH)}
                    width={tooltipW}
                    height={tooltipH}
                    rx={6}
                    className="fill-popover stroke-border"
                    strokeWidth={1}
                  />
                  <text
                    x={rectX + 8}
                    y={Math.min(rectY, H - tooltipH) + tooltipH / 2}
                    dy="0.32em"
                    className="fill-popover-foreground font-mono text-xs tabular-nums"
                  >
                    {text}
                  </text>
                </g>
              );
            })()}
          </g>
        )}

        {/* Pointer-catching overlay over the plot. A tap (touch) keeps its
            tooltip up after the finger lifts; a mouse clears it on leave. */}
        <rect
          data-part="hit"
          x={chart.left}
          y={PAD.top}
          width={chart.innerW}
          height={chart.innerH}
          fill="transparent"
          onPointerDown={(e) => {
            const svg = e.currentTarget.ownerSVGElement;
            if (!svg) return;
            const idx = pointerToIndex(svg, e.clientX, e.clientY);
            setActiveIndex(idx >= 0 ? idx : null);
          }}
          onPointerMove={(e) => {
            const svg = e.currentTarget.ownerSVGElement;
            if (!svg) return;
            const idx = pointerToIndex(svg, e.clientX, e.clientY);
            setActiveIndex(idx >= 0 ? idx : null);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setActiveIndex(null);
          }}
        />
      </svg>

      {/* Text alternative: every value, reachable by keyboard and screen
          reader. Off paper - the printed chart is the report's form. */}
      <details className="print-hide mt-1 text-xs">
        {/* A page shows several charts, so each disclosure is named after
            its chart, explicitly: a name pieced together from the content
            would hang its word break on whitespace that layout may
            collapse. The visible words stay first in the name, so a
            speech-input user can still say what they see (WCAG 2.5.3). */}
        <summary
          aria-label={title ? `${TABLE_TOGGLE} for ${title}` : undefined}
          className="inline-flex min-h-8 cursor-pointer items-center rounded-sm text-muted-foreground hover:text-foreground coarse:min-h-11"
        >
          {TABLE_TOGGLE}
        </summary>
        <div className="mt-1 max-h-64 overflow-auto rounded-md border border-border/60">
          <table className="w-full text-left text-xs tabular-nums">
            <caption className="sr-only">{title ?? "Chart data"}</caption>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border/60 text-muted-foreground">
                <th
                  scope="col"
                  className="px-2 py-1.5 font-medium"
                >
                  Date
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right font-medium"
                >
                  {unit ? `Value (${unit})` : "Value"}
                </th>
                {hasTargets && (
                  <th
                    scope="col"
                    className="px-2 py-1.5 text-right font-medium"
                  >
                    {unit ? `Target (${unit})` : "Target"}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="font-mono">
              {points.map((p) => {
                const t = targetFor(p.x);
                return (
                  <tr
                    key={`row-${p.x}`}
                    className={cn(
                      "border-b border-border/40 last:border-0",
                      p.x === highlightX && "text-signal",
                    )}
                  >
                    <th
                      scope="row"
                      className="px-2 py-1 font-sans font-normal"
                    >
                      {labelFor(p)}
                    </th>
                    <td className="px-2 py-1 text-right">{fmtValue(p.y)}</td>
                    {hasTargets && (
                      <td className="px-2 py-1 text-right text-muted-foreground">
                        {t !== undefined ? fmtValue(t) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
