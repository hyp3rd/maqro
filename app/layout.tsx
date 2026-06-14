import { CookieNotice } from "@/components/shell/CookieNotice";
import { ThemeProvider } from "@/components/theme-provider";
import { getAppUrl } from "@/lib/app-url";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

/** Three-font system:
 *    - Inter (body)         - the workhorse: dense UI, forms, small text.
 *      Excellent at 11–14 px where most of the app lives.
 *    - Manrope (display)    - slightly more character at heading sizes.
 *      Closed apertures and a more confident "g" / "a" / "R" give h1/h2
 *      a different texture from body without clashing.
 *    - JetBrains Mono       - monospace for macro tables, version chips,
 *      slugs. Tabular by default.
 *
 *  `display: "swap"` everywhere - render in fallback first, swap when
 *  ready. The brief FOUT is preferable to a blank-text FOIT for the
 *  perceived-speed budget. */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700", "800"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // metadataBase makes all relative `openGraph.images` and similar
  // resolve against the deployment URL - without it Next emits a
  // build warning and OG crawlers won't fetch the image.
  metadataBase: new URL(getAppUrl()),
  title: {
    default: "Maqro - macros, meal planning, and progress tracking",
    // `%s` is replaced by per-page `metadata.title` strings; the
    // suffix gives every share preview a consistent brand tail.
    template: "%s - Maqro",
  },
  alternates: { canonical: "https://maqro.app" },
  description:
    "Tune your macros, plan your meals, and track your progress. Local-first, no analytics, open source.",
  applicationName: "Maqro",
  keywords: [
    "macro calculator",
    "meal planner",
    "weight tracker",
    "TDEE",
    "Mifflin-St Jeor",
    "nutrition tracking",
  ],
  // Every icon is listed EXPLICITLY. Providing an `icons` object
  // SUPPRESSES Next's file-convention auto-links (app/icon.tsx,
  // app/apple-icon.tsx) — so anything omitted here is simply never
  // emitted. That's what hid the iOS home-screen icon: with no `apple`
  // entry, no `<link rel="apple-touch-icon">` was rendered at all, so
  // iOS (which reads that tag, not the manifest) had nothing to install.
  // Favicon = brand SVG (browsers rasterize it crisply) + the .ico
  // fallback. apple-touch-icon = a static, opaque 180×180 PNG (iOS
  // refuses SVG here). PWA install icons live in the manifest. All the
  // PNGs are static files under public/ — regenerate from
  // /public/logo-mark.svg if the brand mark ever changes.
  icons: {
    icon: [{ url: "/logo-mark.svg", type: "image/svg+xml" }],
    shortcut: "/logo-mark.svg",
    // Explicit size per Apple's spec — emits
    // `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "Maqro",
    title: "Maqro - macros, meal planning, and progress tracking",
    description:
      "Tune your macros, plan your meals, and track your progress. Local-first, no analytics, open source.",
    locale: "en_US",
    // 1200×630 brand card. Twitter / Slack / Discord / iMessage
    // all decode SVG OG images correctly. Facebook still prefers
    // PNG / JPG - once we export a raster version, change `url` to
    // point at it. The width/height hints stop crawlers from
    // re-downloading the asset to measure it.
    images: [
      {
        url: "/og-card.svg",
        width: 1200,
        height: 630,
        alt: "Maqro - macros, meal planning, and progress tracking",
        type: "image/svg+xml",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Maqro - macros, meal planning, and progress tracking",
    description: "Tune your macros, plan your meals, and track your progress.",
    images: ["/og-card.svg"],
  },
  // Tell iOS Safari this can be added to the home screen and run in
  // standalone mode. Combined with theme-color below, this gives the
  // installed-PWA experience a native feel.
  appleWebApp: {
    capable: true,
    title: "Maqro",
    statusBarStyle: "black-translucent",
  },
  // Disable ALL of iOS Safari's automatic data detectors, not just
  // telephone. Safari rewrites text it thinks is a phone number, date,
  // address, or email — wrapping it in its own elements in the DOM
  // BEFORE React hydrates. That mutation makes the client tree differ
  // from the server HTML and throws a hydration mismatch (React #418,
  // a text-content mismatch) — intermittently, on iOS only, depending
  // on whether a rendered number/date happens to match Safari's
  // heuristics. The app is dense with macro numbers ("537", "150g")
  // and dates (Progress, Settings), so the date/address detectors were
  // the remaining trigger after `telephone` was already disabled for
  // the tel:-link symptom.
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
};

/** Viewport + theme-color live in their own export per Next.js 14+.
 *  `viewportFit: "cover"` is the load-bearing bit - it's what lets
 *  `env(safe-area-inset-*)` resolve to actual pixel values on iPhones
 *  with a notch / home indicator. Without it the OS pads the layout
 *  for us and every safe-area utility we sprinkle around becomes a
 *  no-op. `maximumScale` is omitted on purpose - locking zoom is an
 *  a11y regression. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0c" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Resolve the current locale + load its messages server-side.
  // `NextIntlClientProvider` hands these to client components so
  // `useTranslations()` works everywhere without a per-page setup.
  // We always get `en` today (see `i18n/request.ts`); the call
  // shape stays the same when we add more locales.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${manrope.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
        >
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            {/* Toaster lives inside ThemeProvider so `theme="system"`
                picks up the active class. `richColors` gives semantic
                green / red for success / error variants. */}
            <Toaster
              position="bottom-center"
              richColors
              closeButton
              theme="system"
            />
            {/* Cookie/privacy notice - informational only because
             *  Maqro doesn't set non-essential cookies. Mounted in
             *  the root layout so it covers /, /app, /login, and
             *  marketing pages from a single source. */}
            <CookieNotice />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
