import { reportClientError } from "@/lib/error-reporter";
import {
  collectHydrationMutations,
  disconnectHydrationWatch,
  installHydrationWatch,
} from "@/lib/hydration-dom-watch";
import {
  collectHydrationEnvironment,
  type HydrationEnvironment,
} from "@/lib/hydration-environment";
import {
  extractComponentStack,
  isHydrationError,
  summarizeHydrationArgs,
} from "@/lib/hydration-error";

/** Read the cheap DOM/browser signals a hydration mismatch needs for
 *  root-cause attribution (translation? extension? locale mismatch?)
 *  and hand them to the pure classifier. Defensive: any DOM access that
 *  throws (exotic embedded webviews) degrades to "no signal" rather
 *  than masking the underlying hydration report. */
function readHydrationEnvironment(): HydrationEnvironment | undefined {
  try {
    const html = document.documentElement;
    return collectHydrationEnvironment({
      htmlLang: html.getAttribute("lang") ?? "",
      htmlClassList: Array.from(html.classList),
      htmlAttributeNames: html.getAttributeNames(),
      bodyAttributeNames: document.body?.getAttributeNames() ?? [],
      bodyChildTags: Array.from(document.body?.children ?? []).map(
        (el) => el.tagName,
      ),
      navigatorLanguage: navigator.language ?? "",
    });
  } catch {
    return undefined;
  }
}

/** Installs the browser-wide error capture: window errors, unhandled
 *  rejections, and React hydration mismatches.
 *
 *  Called from [instrumentation-client.ts](../instrumentation-client.ts)
 *  so it runs ONCE, on every page, BEFORE React hydrates. That timing is
 *  the whole point — the DOM watcher has to be armed before React patches
 *  the mismatched tree, and this capture must exist app-wide (login,
 *  marketing, `/app`), not only where a shell component happened to mount.
 *
 *  How a hydration mismatch (#418/#423/#425) actually surfaces — this is
 *  subtle and we got it wrong once: it is a RECOVERABLE error, so React
 *  regenerates the tree and reports it through `onRecoverableError`. The
 *  default `onRecoverableError`:
 *
 *    - in PRODUCTION calls `reportError(err)`, which dispatches a window
 *      `error` event (NOT `console.error`). So in prod the mismatch is
 *      invisible to a `console.error` interceptor — it only reaches the
 *      `window.addEventListener("error", …)` handler.
 *    - in DEV additionally logs a verbose `console.error` with the
 *      component stack.
 *
 *  So we route BOTH entry points into the same `reportHydrationMismatch`
 *  (deduped by a one-shot guard). The earlier code hooked only
 *  `console.error`, which is why prod #418s landed as anonymous
 *  `global:error-event` rows and never carried the diagnostic.
 *
 *  Idempotent + permanent: a module-level guard means a second call is a
 *  no-op, and the listeners live for the page's lifetime. */
let installed = false;

export function installErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // Arm the DOM watcher BEFORE hydration so it records the server→client
  // patch React makes when it recovers a mismatch. Read back inside
  // reportHydrationMismatch. See lib/hydration-dom-watch.ts.
  installHydrationWatch();

  // Keep a handle to the real console.error: the diagnostic line is
  // printed through it (so it shows even if server reporting is down) and
  // the interceptor below must call it without re-entering itself.
  const originalConsoleError = console.error;

  // Report a hydration mismatch at most once per page session — the same
  // mismatch can re-surface on each recovery attempt, and one report
  // carries all the signal. `message`/`componentStack` differ by entry
  // point (window-error has neither a readable message nor a stack; the
  // console path has both), so they're passed in.
  let hydrationReported = false;
  function reportHydrationMismatch(
    message: string,
    componentStack: string | undefined,
  ): void {
    if (hydrationReported) return;
    hydrationReported = true;
    // Snapshot the synchronous signals NOW: a translator/extension that
    // mutated the server HTML has already left its marks, and the timing
    // is only meaningful at this instant.
    const env = readHydrationEnvironment();
    const base = {
      path: window.location.pathname,
      // `?view=` lives in the search string, not the pathname — the SPA
      // renders every view under `/app`, so this is the only way the log
      // can tell which screen actually mismatched.
      search: window.location.search,
      componentStack: componentStack ?? "(unavailable in this build)",
      // Milliseconds from navigation start to the mismatch. Small (≈ first
      // paint) ⇒ initial hydration; large ⇒ a deferred Suspense boundary
      // hydrated late (the "no error, then flicker seconds later" shape).
      msSincePageLoad: Math.round(performance.now()),
      // External-cause attribution — see lib/hydration-environment.ts.
      // When `translationActive` or `extensionSignals` is set, the
      // mismatch originates outside the app, not in our render path.
      htmlLang: env?.htmlLang,
      navigatorLanguage: env?.navigatorLanguage,
      localeMismatch: env?.localeMismatch,
      translationActive: env?.translationActive,
      extensionSignals: env?.extensionSignals,
    };
    // The LITERAL server-vs-client divergence(s) React patched are read
    // one frame later (see lib/hydration-dom-watch.ts for the timing) —
    // this is what names the offending value when the component stack is
    // stripped in prod. The report is emitted inside the callback so it
    // carries them; the guard above already prevents a double report.
    // When a translator or a DOM-injecting extension is present, the
    // mismatch originates OUTSIDE our render path (React's own #418 docs
    // call this out) and there's nothing app-side to fix. Downgrade those
    // to "warning" so they don't alert/pollute the Errors view, while
    // still capturing them for visibility.
    const externallyCaused =
      env?.translationActive === true ||
      (env?.extensionSignals?.length ?? 0) > 0;
    collectHydrationMutations((mutations) => {
      disconnectHydrationWatch();
      // Empty `mutations` means React recovered without a text/attr/node
      // change the observer could see (e.g. a structural-only mismatch).
      const context = { ...base, mutations, externallyCaused };
      // Surface the diagnostic in the BROWSER CONSOLE too, right next to
      // React's (minified, uninformative) #418, using the ORIGINAL
      // console.error to avoid re-entering the interceptor.
      originalConsoleError(
        "⚠️ [Maqro] hydration-mismatch diagnostic:",
        JSON.stringify(context),
      );
      reportClientError(message, {
        route: "hydration-mismatch",
        level: externallyCaused ? "warning" : "error",
        context,
      });
    });
  }

  window.addEventListener("error", (event) => {
    const raisedError = event.error ?? event.message;
    // In production this is how a React hydration mismatch arrives (see
    // the function doc): `reportError()` → a window `error` event. Route
    // it to the enriched path instead of logging an anonymous global
    // error.
    if (isHydrationError([raisedError])) {
      reportHydrationMismatch(
        raisedError instanceof Error
          ? raisedError.message
          : String(raisedError),
        undefined, // the window-error path carries no component stack
      );
      return;
    }
    reportClientError(raisedError, {
      route: "global:error-event",
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, { route: "global:unhandled-rejection" });
  });

  // The DEV entry point: React logs the verbose mismatch (with component
  // stack) through console.error. The original is always called so dev
  // logging is untouched.
  console.error = (...args: unknown[]) => {
    if (isHydrationError(args)) {
      reportHydrationMismatch(
        summarizeHydrationArgs(args),
        extractComponentStack(args),
      );
    }
    originalConsoleError.apply(console, args as never[]);
  };
}
