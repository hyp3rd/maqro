import { installErrorCapture } from "@/lib/install-error-capture";

/** Next.js client instrumentation — runs once in the browser BEFORE the
 *  app hydrates. We use it to arm error capture early enough to catch
 *  React hydration mismatches (#418/#423/#425), which fire during
 *  hydration and so are invisible to any handler installed later in a
 *  component effect. See
 *  [lib/install-error-capture.ts](./lib/install-error-capture.ts) for
 *  the why. */
installErrorCapture();
