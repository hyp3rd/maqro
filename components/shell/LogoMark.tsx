/** Constructivist Maqro mark — two stems, a baseline bridge, and a
 *  precision dot. Drawn on the 64×74 viewBox documented in
 *  [assets/design/logo/README.md](../../assets/design/logo/README.md);
 *  set the `size` prop to control the height in px (the width
 *  follows the 64:74 aspect ratio automatically).
 *
 *  Fills use `currentColor` so callers control the color via CSS —
 *  `className="text-foreground"` for light mode, `text-background`
 *  for inverse on dark surfaces, any utility you want. This is what
 *  the brand README asks for; it also keeps a single source of
 *  truth for the geometry (the inline path) instead of forking
 *  light/dark SVGs.
 *
 *  The precision dot disappears below ~14 px height; the U-form
 *  still reads. For favicons / very small placements, prefer the
 *  static `/logo-mark.svg` over this component so the rasterizer
 *  has more to work with. */
export function LogoMark({
  size = 24,
  className,
  title = "Maqro",
}: {
  /** Rendered height in px. Width follows the aspect ratio. */
  size?: number;
  className?: string;
  /** Accessible name. Set to empty string when the mark sits next
   *  to a "Maqro" wordmark or a labelled link — duplicating the
   *  brand name in the SVG title would just make screen readers
   *  announce "Maqro Maqro link". */
  title?: string;
}) {
  const width = (size * 64) / 74;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 74"
      width={width}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={className}
    >
      {title && <title>{title}</title>}
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
    </svg>
  );
}
