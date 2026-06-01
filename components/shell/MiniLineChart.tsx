"use client";

import { useId, useMemo, useState } from "react";

export type LinePoint = {
  /** Numeric x value - for time series, pass a unix-day index or epoch ms. */
  x: number;
  y: number;
  /** Optional human label shown on a few ticks. */
  label?: string;
  /** Optional human label for the hover tooltip. Falls back to `label`
   *  then to the raw `x` value when not set. */
  tooltipLabel?: string;
};

type Props = {
  data: LinePoint[];
  /** Total width / height of the SVG (CSS pixels). */
  width?: number;
  height?: number;
  /** Force the y axis to include 0; useful for some metrics, off for weight. */
  yIncludeZero?: boolean;
  /** Number of x-axis labels to render. Picked evenly across the data. */
  xTicks?: number;
  /** Unit suffix shown on the y-axis ticks (e.g. "kg"). */
  yUnit?: string;
  /** Optional horizontal reference line (e.g. target calories). The line
   * is dashed and labelled at the right edge. */
  targetY?: number;
  /** Short text shown next to the reference line. */
  targetLabel?: string;
  /** When true, smooth the line via Catmull–Rom interpolation. Off
   *  reverts to the straight-segment polyline. Default on. */
  smooth?: boolean;
};

/** Lightweight line chart in pure SVG. No charting library - Catmull–Rom
 *  smoothing, gradient fill, hover crosshair, and tooltip are all
 *  hand-rolled in ~30 lines extra.
 *
 *  Returns null if `data` is empty - the caller renders the empty state. */
export function MiniLineChart({
  data,
  width = 640,
  height = 220,
  yIncludeZero = false,
  xTicks = 5,
  yUnit = "",
  targetY,
  targetLabel,
  smooth = true,
}: Props) {
  const gradientId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Hooks must run before the early return. The expensive
  // path-string builds are memoized so hover-driven re-renders only
  // touch the tooltip overlay, not the line itself.
  // Left padding sized for the widest reasonable Y-axis label.
  // Bumped from 40 → 56 so the right-anchored axis text never
  // clips off the SVG's left edge — happens on imperial weight
  // ("165.3 lb"), 4-digit kcal ("2,557 kcal"), and any other yUnit
  // longer than a single character. 56 still leaves plenty of
  // horizontal room for the actual chart on a 320px-wide viewport
  // (~140px after the viewBox scales down from 640).
  const padding = useMemo(
    () => ({ top: 12, right: 16, bottom: 28, left: 56 }),
    [],
  );
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const { xMin, xSpan, yMin, ySpan } = useMemo(() => {
    if (data.length === 0) {
      return { xMin: 0, xSpan: 1, yMin: 0, ySpan: 1 };
    }
    const xs = data.map((p) => p.x);
    const ys = data.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const xSpan = Math.max(1, xMax - xMin);
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (yIncludeZero) yMin = Math.min(yMin, 0);
    if (targetY !== undefined) {
      yMin = Math.min(yMin, targetY);
      yMax = Math.max(yMax, targetY);
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.1;
    yMin -= pad;
    yMax += pad;
    return { xMin, xSpan, yMin, ySpan: yMax - yMin };
  }, [data, yIncludeZero, targetY]);

  const xScale = (x: number) => padding.left + ((x - xMin) / xSpan) * innerW;
  const yScale = (y: number) => padding.top + (1 - (y - yMin) / ySpan) * innerH;

  // Build the line + area path. Catmull–Rom for ≥3 points; fall back to
  // straight segments otherwise (smoothing 2 points isn't meaningful).
  // Scale math is inlined here so the useMemo's deps stay primitive
  // (the outer xScale/yScale closures would otherwise re-trigger on
  // every render, defeating the memo).
  const { linePath, areaPath } = useMemo(() => {
    if (data.length === 0) return { linePath: "", areaPath: "" };
    const xs = (x: number) => padding.left + ((x - xMin) / xSpan) * innerW;
    const ys = (y: number) => padding.top + (1 - (y - yMin) / ySpan) * innerH;
    const pts = data.map((p) => ({ x: xs(p.x), y: ys(p.y) }));
    let line: string;
    if (!smooth || pts.length < 3) {
      line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    } else {
      // Catmull–Rom → cubic Bezier. For each segment P[i]→P[i+1],
      // control points are derived from P[i-1] and P[i+2]. Edge
      // segments clamp to the endpoint so the curve starts and
      // ends anchored at the first/last data point.
      const ctrl = (a: number, b: number) => (b - a) / 6;
      line = `M${pts[0].x},${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        const c1x = p1.x + ctrl(p0.x, p2.x);
        const c1y = p1.y + ctrl(p0.y, p2.y);
        const c2x = p2.x - ctrl(p1.x, p3.x);
        const c2y = p2.y - ctrl(p1.y, p3.y);
        line += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
      }
    }
    const baseline = padding.top + innerH;
    const area = `${line} L${pts[pts.length - 1].x},${baseline} L${pts[0].x},${baseline} Z`;
    return { linePath: line, areaPath: area };
  }, [
    data,
    smooth,
    padding.top,
    padding.left,
    innerH,
    innerW,
    xMin,
    xSpan,
    yMin,
    ySpan,
  ]);

  if (data.length === 0) return null;

  // Y-axis ticks: 4 evenly spaced.
  const yTickValues = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * ySpan);

  const xLabelIndices: number[] =
    data.length === 1
      ? [0]
      : Array.from(
          new Set(
            Array.from({ length: xTicks }, (_, i) =>
              Math.round((i * (data.length - 1)) / (xTicks - 1)),
            ),
          ),
        );

  // Hover: translate the pointer's x into the nearest data index.
  function pointerToIndex(clientX: number, rect: DOMRect): number {
    // SVG is rendered with viewBox + responsive width; map the
    // client x back into the viewBox coordinate, then find the
    // closest data point by `x` value.
    const svgX = ((clientX - rect.left) / rect.width) * width;
    if (svgX < padding.left || svgX > padding.left + innerW) return -1;
    // Walk the data and pick the closest. With < 100 points this is
    // negligible cost - binary search would be premature.
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(xScale(data[i].x) - svgX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  const active = activeIndex !== null ? data[activeIndex] : null;
  const tooltipLabel = active
    ? (active.tooltipLabel ?? active.label ?? String(active.x))
    : "";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto text-foreground"
      role="img"
      aria-label={`Line chart with ${data.length} data points`}
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
            stopOpacity="0.18"
          />
          <stop
            offset="100%"
            stopColor="currentColor"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>

      {/* Horizontal gridlines + y-axis labels */}
      {yTickValues.map((v) => {
        const y = yScale(v);
        return (
          <g key={v.toFixed(3)}>
            <line
              x1={padding.left}
              x2={padding.left + innerW}
              y1={y}
              y2={y}
              className="stroke-border/50"
              strokeWidth={1}
            />
            <text
              x={padding.left - 6}
              y={y}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted-foreground text-[10px] tabular-nums"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {Math.round(v * 10) / 10}
              {yUnit}
            </text>
          </g>
        );
      })}

      {/* X-axis labels. First / last anchor to "start" / "end" so
       *  they hug the chart bounds rather than extending past them
       *  — with the default `textAnchor="middle"`, a date like
       *  "May 25" at the rightmost data point would render half its
       *  width to the right of the chart and clip off the SVG (the
       *  bug visible on the /progress weight chart). Interior
       *  labels stay middle-anchored so they sit centred over
       *  their data point. */}
      {xLabelIndices.map((i, position) => {
        const p = data[i];
        if (!p) return null;
        const isFirst = position === 0;
        const isLast = position === xLabelIndices.length - 1;
        const anchor = isFirst ? "start" : isLast ? "end" : "middle";
        return (
          <text
            key={`x-${i}`}
            x={xScale(p.x)}
            y={padding.top + innerH + 16}
            textAnchor={anchor}
            className="fill-muted-foreground text-[10px] tabular-nums"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {p.label ?? p.x}
          </text>
        );
      })}

      {/* Optional target reference line + label */}
      {targetY !== undefined && (
        <g>
          <line
            x1={padding.left}
            x2={padding.left + innerW}
            y1={yScale(targetY)}
            y2={yScale(targetY)}
            className="stroke-foreground/50"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          {targetLabel && (
            <text
              x={padding.left + innerW - 4}
              y={yScale(targetY) - 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {targetLabel}
            </text>
          )}
        </g>
      )}

      {/* Area under the line */}
      <path
        d={areaPath}
        fill={`url(#${gradientId})`}
        stroke="none"
      />

      {/* The line itself */}
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Data point dots */}
      {data.map((p, i) => (
        <circle
          key={`dot-${i}`}
          cx={xScale(p.x)}
          cy={yScale(p.y)}
          r={2}
          fill="currentColor"
        />
      ))}

      {/* Hover crosshair + emphasized dot + tooltip. Rendered on top
          of the line so it always wins z-order. */}
      {active && (
        <g pointerEvents="none">
          <line
            x1={xScale(active.x)}
            x2={xScale(active.x)}
            y1={padding.top}
            y2={padding.top + innerH}
            className="stroke-foreground/30"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
          <circle
            cx={xScale(active.x)}
            cy={yScale(active.y)}
            r={4}
            className="fill-background stroke-foreground"
            strokeWidth={1.5}
          />
          {/* Tooltip - anchored so it stays on-screen at both edges. */}
          {(() => {
            const tx = xScale(active.x);
            const ty = yScale(active.y);
            const text = `${tooltipLabel} · ${active.y.toFixed(1)}${yUnit}`;
            const charW = 6.2; // text-[10px] mono ≈ 6.2 px/char
            const tooltipW = Math.min(width - 10, text.length * charW + 16);
            const tooltipH = 22;
            // Prefer right of the dot; flip left if it'd overflow.
            const goLeft = tx + tooltipW + 10 > padding.left + innerW;
            const rectX = goLeft ? tx - tooltipW - 10 : tx + 10;
            // Prefer above the dot; flip below if it'd overflow.
            const rectY =
              ty - tooltipH - 6 < padding.top ? ty + 12 : ty - tooltipH - 6;
            return (
              <g>
                <rect
                  x={rectX}
                  y={rectY}
                  width={tooltipW}
                  height={tooltipH}
                  rx={4}
                  className="fill-popover stroke-border/60"
                  strokeWidth={1}
                />
                <text
                  x={rectX + 8}
                  y={rectY + tooltipH / 2}
                  dy="0.32em"
                  className="fill-popover-foreground text-[10px] tabular-nums"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {text}
                </text>
              </g>
            );
          })()}
        </g>
      )}

      {/* Pointer-catching overlay. Transparent so it doesn't repaint
          anything visible; sized to the inner chart area. */}
      <rect
        x={padding.left}
        y={padding.top}
        width={innerW}
        height={innerH}
        fill="transparent"
        onPointerMove={(e) => {
          const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
          if (!rect) return;
          const idx = pointerToIndex(e.clientX, rect);
          setActiveIndex(idx >= 0 ? idx : null);
        }}
        onPointerLeave={() => setActiveIndex(null)}
        onTouchStart={(e) => {
          const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
          if (!rect || e.touches.length === 0) return;
          const idx = pointerToIndex(e.touches[0].clientX, rect);
          setActiveIndex(idx >= 0 ? idx : null);
        }}
      />
    </svg>
  );
}
