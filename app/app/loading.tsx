import { Skeleton, SkeletonListRow } from "@/components/ui/skeleton";

/** Next.js `loading.tsx` for the `/app` segment. Renders during route
 *  navigation AND while the page bundle is hydrating, so a user with
 *  a slow connection sees the shell outline instead of a blank
 *  screen for the first ~200-500 ms.
 *
 *  Matches the live shell's broad geometry — topbar height, sidebar
 *  width on desktop, main-pane gap — so the visual jump when the
 *  real content lands is minimal (no layout shock). Pure
 *  presentational: no client hooks, no data, no logic — Next renders
 *  this on the server when navigation starts. */
export default function AppLoading() {
  return (
    <div
      className="flex h-screen overflow-hidden"
      aria-busy="true"
      aria-label="Loading the app"
    >
      <aside
        className="hidden w-56 shrink-0 border-r bg-muted/20 md:block"
        aria-hidden
      />
      <div className="flex flex-1 flex-col">
        <header
          className="flex h-14 shrink-0 items-center gap-3 border-b bg-muted/20 px-4"
          aria-hidden
        >
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-4 w-32" />
        </header>
        <main className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="mx-auto max-w-3xl space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-24 w-full" />
            <div className="space-y-2">
              <SkeletonListRow />
              <SkeletonListRow />
              <SkeletonListRow />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
