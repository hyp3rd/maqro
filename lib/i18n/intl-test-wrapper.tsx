import type * as React from "react";
import { NextIntlClientProvider } from "next-intl";
import type { Locale } from "./locale";

/** Test-only `render` wrapper for components that read the app locale
 *  (`useLocale()`), as the root layout's NextIntlClientProvider does in the
 *  app: `render(ui, { wrapper: intlWrapper("it") })`. */
export function intlWrapper(locale: Locale = "en") {
  return function IntlWrapper({ children }: { children: React.ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale}>
        {children}
      </NextIntlClientProvider>
    );
  };
}
