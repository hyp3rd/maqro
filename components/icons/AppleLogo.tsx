import type { SVGProps } from "react";

/** Apple's logomark as an inline SVG.
 *
 *  Used wherever a Sign-in-with-Apple affordance appears (the
 *  `/login` button, the connect-account row in Settings). Inline
 *  rather than a remote asset for the same reasons as
 *  [GoogleLogo](./GoogleLogo.tsx): tiny, no extra network fetch, no
 *  CSP entry, and we own the file.
 *
 *  Single-color and `fill="currentColor"` so it inherits the button's
 *  text color — Apple's brand guidelines require the mark to be solid
 *  black on light surfaces and solid white on dark, which
 *  `currentColor` satisfies automatically since our outline buttons
 *  use `text-foreground` (near-black in light theme, near-white in
 *  dark). The mark is the unprotected logomark, not the wordmark. */
export function AppleLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.89 2.65 3.23 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.03 2.28-1.27 3.14-2.53.99-1.45 1.4-2.86 1.42-2.93-.03-.01-2.72-1.04-2.75-4.13z" />
      <path d="M14.69 4.46c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.45z" />
    </svg>
  );
}
