"use server";

import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/locale";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

/** Server action invoked by the LocaleSwitcher to persist the user's
 *  pick across requests. Validates the input strictly — a malformed
 *  locale must not be writeable to the cookie, or
 *  [i18n/request.ts](../../i18n/request.ts)'s resolver will fall
 *  through to Accept-Language and the user's pick will look like it
 *  was silently ignored.
 *
 *  We `revalidatePath('/', 'layout')` after writing so the next render
 *  pulls the new messages bundle — without it, the user picks "it"
 *  and the page they're looking at stays English until they navigate.
 *
 *  Cookie attributes: 1-year `Max-Age` (a UI preference, not a
 *  session-bound value), `Path=/` (every route reads it),
 *  `SameSite=Lax` (form submissions from internal pages must still
 *  set it; we never want a third-party origin to set it for us),
 *  no `HttpOnly` (intentionally readable from the client so the
 *  switcher can show the active locale without a server round-trip
 *  on every render). */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const next = formData.get("locale");
  if (!isLocale(next)) return;

  const store = await cookies();
  store.set({
    name: LOCALE_COOKIE,
    value: next,
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });

  // Invalidate every cached layout so the next render uses the new
  // messages bundle. The 'layout' scope is broader than 'page' on
  // purpose — the locale flows in through the root layout's
  // NextIntlClientProvider, not through individual page modules.
  revalidatePath("/", "layout");
}
