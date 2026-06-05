/** `@maqro/core` — platform-agnostic domain logic shared by the web app and
 *  (soon) the native app. Pure TypeScript: no React, no DOM, no server or
 *  storage dependencies, so it runs identically under Next.js, Vitest, and
 *  React Native / Metro.
 *
 *  Increment 1 of the extraction is the macro engine and its domain model. The
 *  old `@/lib/...` and `@/components/macro/types` paths now re-export from here
 *  (thin shims), so existing imports keep working unchanged. */
export * from "./age";
export * from "./macros";
export * from "./rda";
export * from "./types";
