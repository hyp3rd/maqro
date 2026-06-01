import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/locale";
import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

/** next-intl per-request config. Loaded by the `createNextIntlPlugin`
 *  webpack/Turbopack hook configured in `next.config.ts`.
 *
 *  Locale resolution lives in [lib/i18n/locale.ts](../lib/i18n/locale.ts):
 *  the `NEXT_LOCALE` cookie wins (set by the LocaleSwitcher's server
 *  action when the user picks explicitly), then the request's
 *  `Accept-Language` header, then the default ("en"). The cookie is
 *  what makes a deliberate pick stick across visits; the
 *  Accept-Language fallback gives a sane first-visit experience for
 *  Italian-speaking browsers without making them hunt for a switcher.
 *
 *  Subpath routing (`/<locale>/...`) is intentionally NOT enabled —
 *  the app lives at `/app` and adding `/en/app` everywhere would
 *  invalidate every existing bookmark + shared link.
 *
 *  Keep the `messages` import dynamic so unused locales never end up
 *  in the production bundle. The catch-and-fallback in
 *  `loadMessages` is defensive: a deploy where a JSON file failed
 *  to bundle should serve English, not 500. */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerList = await headers();
  const cookieValue = cookieStore.get(LOCALE_COOKIE)?.value;
  const acceptLanguage = headerList.get("accept-language") ?? undefined;

  const locale = resolveLocale(cookieValue, acceptLanguage);
  const messages = await loadMessages(locale);
  return { locale, messages };
});

async function loadMessages(locale: string): Promise<Record<string, unknown>> {
  try {
    return (await import(`../messages/${locale}.json`)).default;
  } catch {
    return (await import("../messages/en.json")).default;
  }
}
