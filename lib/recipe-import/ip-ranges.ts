/** Private/loopback/link-local IP range check.
 *
 *  Shared between the string-validation gate in [./fetch.ts](./fetch.ts)
 *  and the connect-time dispatcher in [./safe-agent.ts](./safe-agent.ts).
 *  Both must agree on what counts as a "non-public" address — a drift
 *  between them would open a window where one layer accepts and the
 *  other rejects (or vice versa), so a single source of truth here
 *  is load-bearing.
 *
 *  Ranges covered:
 *    - IPv4: 10/8, 172.16/12, 192.168/16, 169.254/16 (link-local +
 *      cloud metadata), 127/8 (loopback), 0/8, 100.64/10 (CGN).
 *    - IPv6: ::1 (loopback), ::, fe80::/10 (link-local),
 *      fc00::/7 (ULA), ::ffff:<private-v4> (IPv4-mapped wraps).
 *
 *  If a range is added, both the unit tests in
 *  [./fetch.test.ts](./fetch.test.ts) and the dispatcher behaviour
 *  in [./safe-agent.ts](./safe-agent.ts) get the new coverage for
 *  free — they all call this. */

export function isPrivateOrSpecialIp(ip: string): boolean {
  // IPv4 literal: check octet ranges.
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1, 5).map(Number) as [number, number, number, number];
    if (o.some((n) => n < 0 || n > 255)) return true; // Malformed → reject.
    if (o[0] === 10) return true; // 10/8
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16/12
    if (o[0] === 192 && o[1] === 168) return true; // 192.168/16
    if (o[0] === 169 && o[1] === 254) return true; // 169.254/16 link-local + cloud metadata
    if (o[0] === 127) return true; // 127/8 loopback
    if (o[0] === 0) return true; // 0/8
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // 100.64/10 CGN
    return false;
  }
  // IPv6: bracket-stripped, lowercased. Block ULA + link-local + loopback.
  if (ip.includes(":")) {
    const lo = ip.replace(/[[\]]/g, "").toLowerCase();
    if (lo === "::1" || lo === "::") return true;
    if (/^fe[89ab][0-9a-f]:/.test(lo)) return true; // fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(lo)) return true; // fc00::/7
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — extract and re-check.
    const mapped = lo.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped && mapped[1]) return isPrivateOrSpecialIp(mapped[1]);
  }
  return false;
}
