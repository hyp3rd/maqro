/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserClient } from "@supabase/ssr";
import { authStorageKey, storedSessionUserId } from "./stored-session";

const SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
const KEY = authStorageKey(SUPABASE_URL);

function clearCookies() {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

/** The token-endpoint answer for a password sign-in as `user`. */
function tokenResponse(user: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      access_token: "header.payload.signature",
      refresh_token: "refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Has the real @supabase/ssr browser client store a session for `user`
 *  in document.cookie, exactly as the app's client would. */
async function storeSessionWithRealClient(user: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => tokenResponse(user));
  const client = createBrowserClient(SUPABASE_URL, "sb_publishable_test", {
    isSingleton: false,
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchMock },
  });
  const { error } = await client.auth.signInWithPassword({
    email: "a@example.com",
    password: "password",
  });
  expect(error).toBeNull();
  expect(fetchMock).toHaveBeenCalled();
}

beforeEach(clearCookies);
afterEach(clearCookies);

describe("storedSessionUserId", () => {
  it("reads the user id of the session the real browser client stored", async () => {
    await storeSessionWithRealClient({ id: "u1", aud: "authenticated" });
    expect(document.cookie).toContain(KEY);
    await expect(
      storedSessionUserId(SUPABASE_URL, document.cookie),
    ).resolves.toBe("u1");
  });

  it("reassembles a session the client split across chunk cookies", async () => {
    await storeSessionWithRealClient({
      id: "u2",
      aud: "authenticated",
      user_metadata: { bio: "x".repeat(6000) },
    });
    expect(document.cookie).toContain(`${KEY}.1=`);
    await expect(
      storedSessionUserId(SUPABASE_URL, document.cookie),
    ).resolves.toBe("u2");
  });

  it("is null when no session is stored", async () => {
    await expect(
      storedSessionUserId(SUPABASE_URL, document.cookie),
    ).resolves.toBeNull();
  });

  it("is null for another project's session", async () => {
    await storeSessionWithRealClient({ id: "u1" });
    await expect(
      storedSessionUserId("https://otherproject.supabase.co", document.cookie),
    ).resolves.toBeNull();
  });

  it.each([
    ["undecodable base64", "base64-%%%%"],
    ["not JSON", "not-json"],
    ["no user", JSON.stringify({ access_token: "t" })],
    ["a blank user id", JSON.stringify({ user: { id: "" } })],
  ])("is null for %s", async (_name, value) => {
    const header = `${KEY}=${encodeURIComponent(value)}`;
    await expect(storedSessionUserId(SUPABASE_URL, header)).resolves.toBeNull();
  });

  it("reads an unencoded (plain JSON) session too", async () => {
    const header = `${KEY}=${encodeURIComponent(JSON.stringify({ user: { id: "u3" } }))}`;
    await expect(storedSessionUserId(SUPABASE_URL, header)).resolves.toBe("u3");
  });
});
