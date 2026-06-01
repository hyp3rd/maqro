/** Horizontal lockup — constructivist mark + MAQRO wordmark. The
 *  source is `/assets/design/logo/logo-wordmark.svg` (also dropped
 *  into `/public/logo-wordmark.svg` for static refs); inlined here
 *  with `currentColor` fills so the lockup inherits the parent's
 *  color, exactly like LogoMark.
 *
 *  Geometry (280 × 60 viewBox):
 *    - Mark group at `translate(2 4) scale(0.625)` — the mark's
 *      native 64 × 74 collapses to ~40 × 46 inside the lockup.
 *    - Wordmark at `x=58`, `y=42`, Manrope-700, 26 px, letter-spacing 5.
 *
 *  Sizing: pass `size` in px (the SVG height). Width follows the
 *  280 : 60 aspect ratio (4.67×). Below ~32 px height the wordmark
 *  text becomes unreadable; the responsive callsites in the app
 *  swap to `<LogoMark>` at mobile breakpoints rather than shrinking
 *  this further. */
export function LogoWordmark({
  size = 28,
  className,
  title = "Maqro",
}: {
  /** Rendered height in px. Width = size × 280 / 60. */
  size?: number;
  className?: string;
  /** Accessible name. Defaults to "Maqro"; pass empty string when
   *  the lockup is decorative alongside a labelled link. */
  title?: string;
}) {
  const width = (size * 280) / 60;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 280 60"
      width={width}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={className}
    >
      {title && <title>{title}</title>}
      <g transform="translate(2 4) scale(0.625)">
        <rect
          x="10"
          y="14"
          width="8"
          height="56"
          fill="currentColor"
        />
        <rect
          x="42"
          y="14"
          width="8"
          height="42"
          fill="currentColor"
        />
        <rect
          x="10"
          y="48"
          width="40"
          height="8"
          fill="currentColor"
        />
        <circle
          cx="58"
          cy="10"
          r="3"
          fill="currentColor"
        />
      </g>
      <text
        x="58"
        y="42"
        fontFamily="Manrope, system-ui, -apple-system, sans-serif"
        fontSize="26"
        fontWeight="700"
        letterSpacing="5"
        fill="currentColor"
      >
        MAQRO
      </text>
    </svg>
  );
}
