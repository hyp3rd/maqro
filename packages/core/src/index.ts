/** `@maqro/core` — platform-agnostic domain logic shared by the web app and
 *  (soon) the native app. Pure TypeScript: no React, no DOM, no server or
 *  storage dependencies, so it runs identically under Next.js, Vitest, and
 *  React Native / Metro.
 *
 *  The old `@/lib/...` and `@/components/macro/types` paths re-export from here
 *  (thin shims), so existing imports keep working unchanged. */
export * from "./age";
export * from "./date";
export * from "./fasting";
export * from "./goal-phases";
export * from "./macros";
export * from "./off";
export * from "./rda";
export * from "./records";
export * from "./trends";
export * from "./types";
export * from "./weekly-recap";
