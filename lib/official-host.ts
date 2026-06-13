import { headers } from "next/headers";

/** Canonical production hostnames for the hosted app. */
const OFFICIAL_HOSTS = new Set(["maqro.app", "www.maqro.app"]);

/** Whether the current request is served from the canonical production host
 *  (maqro.app / www.maqro.app).
 *
 *  The legal pages' "maintainer's draft, not legal advice" notice is guidance
 *  for OTHER operators (forks, self-hosters) and for local development — on
 *  the official deployment these ARE the accepted terms, so the notice is just
 *  noise. Anything not in the set (localhost, *.vercel.app previews, forked
 *  domains) is treated as non-official and keeps the notice.
 *
 *  Reads the request `host` header (port-stripped, lowercased), which opts the
 *  caller into dynamic rendering. Host-based by design — an env flag couldn't
 *  tell maqro.app apart from a fork's own production deployment. */
export async function isOfficialHost(): Promise<boolean> {
  const raw = (await headers()).get("host") ?? "";
  const host = raw.toLowerCase().split(":")[0];
  return OFFICIAL_HOSTS.has(host);
}
