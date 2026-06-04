// Supply-chain guard: refuse to install (or pass CI) if any *unscoped*
// `supabase` / `supabase-*` npm package shows up in the manifest or the
// resolved lockfile.
//
// Context (2026): npm published "all versions, no fix" malware advisories for
// the `supabase` package (GHSA-x96m-c5fj-q75c) and `supabase-react`
// (GHSA-rhm3-8hhw-pp5w) — a campaign squatting the `supabase` name on the
// registry. The *legitimate* Supabase libraries are all SCOPED
// (`@supabase/supabase-js`, `@supabase/ssr`, …) and the CLI is installed via
// Homebrew / the official installer, never npm. So no unscoped `supabase*`
// package should ever appear in this project — this guard makes that invariant
// enforceable at `preinstall` (aborting before a flagged package is even
// downloaded or its install scripts run) and again in `make ci`.
//
// Zero dependencies (Node built-ins only, so it runs at preinstall before
// anything is installed) and fail-OPEN on its own errors: it exits non-zero
// ONLY on a real positive, never on a read/parse hiccup, so the guard can
// never itself break an install or a deploy.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Unscoped `supabase` or `supabase-<anything>`. Scoped `@supabase/*` (the real
 *  libraries) start with `@`, so they never match. */
const BANNED = /^supabase($|-)/;

/** Last path segment of a lockfile-v2/v3 `packages` key:
 *  `node_modules/a/node_modules/@s/b` → `@s/b`. */
function nameFromLockKey(key) {
  const marker = "node_modules/";
  const i = key.lastIndexOf(marker);
  return i === -1 ? key : key.slice(i + marker.length);
}

function collectNames() {
  const names = new Set();

  // 1) Direct manifest entries — always present, even on a first install.
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const name of Object.keys(pkg[field] ?? {})) names.add(name);
    }
  } catch {
    // Unreadable manifest → nothing to assert from it; fail open.
  }

  // 2) The full resolved tree from the lockfile, when one exists.
  try {
    const lock = JSON.parse(
      readFileSync(join(ROOT, "package-lock.json"), "utf8"),
    );
    // lockfileVersion 2/3: every installed package is a `packages` key.
    for (const key of Object.keys(lock.packages ?? {})) {
      if (key) names.add(nameFromLockKey(key));
    }
    // lockfileVersion 1 fallback: nested `dependencies`.
    const walk = (deps) => {
      for (const [name, meta] of Object.entries(deps ?? {})) {
        names.add(name);
        if (meta && typeof meta === "object" && meta.dependencies) {
          walk(meta.dependencies);
        }
      }
    };
    walk(lock.dependencies);
  } catch {
    // No lockfile yet (very first install) → the manifest check still ran.
  }

  return names;
}

let banned = [];
try {
  banned = [...collectNames()].filter((name) => BANNED.test(name)).sort();
} catch (err) {
  console.warn(
    `[banned-deps] guard skipped (non-fatal): ${err?.message ?? err}`,
  );
  process.exit(0);
}

if (banned.length > 0) {
  console.error(
    `\n\x1b[31m✖ banned dependency detected\x1b[0m\n` +
      `  These unscoped \`supabase*\` packages are flagged as malware\n` +
      `  (GHSA-x96m-c5fj-q75c / GHSA-rhm3-8hhw-pp5w) and must not be installed:\n` +
      banned.map((name) => `    - ${name}`).join("\n") +
      `\n\n  The real Supabase libraries are scoped (@supabase/*); install the\n` +
      `  CLI via Homebrew, not npm. Remove the package(s) above, then reinstall.\n`,
  );
  process.exit(1);
}

console.log("✓ banned-deps guard: no unscoped supabase* packages");
