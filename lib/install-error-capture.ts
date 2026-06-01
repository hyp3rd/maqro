import { reportClientError } from "@/lib/error-reporter";
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
 *  so it runs ONCE, on every page, BEFORE React hydrates. That timing
 *  is the whole point:
 *
 *    - A hydration mismatch (React #418/#423/#425) is a RECOVERABLE
 *      error — React logs it via `console.error` and quietly
 *      regenerates the tree. It never throws to `window.error` and
 *      never reaches a React error boundary, so a `useEffect`-mounted
 *      handler (the old approach) can't see it AND, worse, the mismatch
 *      fires DURING hydration, before any effect runs. The interceptor
 *      has to exist before hydration to catch it. Instrumentation-
 *      client is the only place that's guaranteed.
 *    - It also means this capture is app-wide (login, marketing,
 *      `/app`) instead of only where a shell component happened to
 *      mount.
 *
 *  Idempotent + permanent: a module-level guard means a second call is
 *  a no-op, and the listeners live for the page's lifetime (no
 *  teardown — there's nothing to clean up before navigation away). */
let installed = false;

export function installErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportClientError(event.error ?? event.message, {
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

  // Intercept console.error to catch hydration mismatches. Report at
  // most once per page session — the same mismatch can re-log on each
  // recovery attempt, and one report carries all the signal (component
  // stack + path). The original console.error is always called so dev
  // logging is untouched.
  let hydrationReported = false;
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (!hydrationReported && isHydrationError(args)) {
      hydrationReported = true;
      // Snapshot the DOM now: a translator/extension that mutated the
      // server HTML has already left its marks by the time React logs
      // the mismatch, so the signals are present at report time.
      const env = readHydrationEnvironment();
      const context = {
        path: window.location.pathname,
        // `?view=` lives in the search string, not the pathname — the
        // SPA renders every view under `/app`, so this is the only way
        // the log can tell which screen actually mismatched.
        search: window.location.search,
        componentStack:
          extractComponentStack(args) ?? "(unavailable in this build)",
        // External-cause attribution — see lib/hydration-environment.ts.
        // When `translationActive` or `extensionSignals` is set, the
        // mismatch originates outside the app, not in our render path.
        htmlLang: env?.htmlLang,
        navigatorLanguage: env?.navigatorLanguage,
        localeMismatch: env?.localeMismatch,
        translationActive: env?.translationActive,
        extensionSignals: env?.extensionSignals,
      };
      // Also surface the diagnostic in the BROWSER CONSOLE, right next to
      // React's (minified, uninformative) #418. The server-side error log
      // can be unreachable (missing secret, disabled), and the console is
      // where the mismatch is actually seen — printing a single
      // diagnostic line here means the attribution travels with the
      // error no matter how it's reported. Uses the ORIGINAL console.error
      // to avoid re-entering this interceptor.
      originalConsoleError(
        "⚠️ [Maqro] hydration-mismatch diagnostic — copy this line:",
        JSON.stringify(context),
      );
      reportClientError(summarizeHydrationArgs(args), {
        route: "hydration-mismatch",
        context,
      });
    }
    originalConsoleError.apply(console, args as never[]);
  };
}
