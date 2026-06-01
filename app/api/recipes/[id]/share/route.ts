import type { ShareVisibility } from "@/components/macro/types";
import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { generateShareSlug } from "@/lib/share-slug";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const PatchBodySchema = z.object({
  visibility: z.enum(["public", "members", "disabled"]),
});

/** Mint a share slug for a recipe the caller owns. Idempotent: if the
 *  recipe is already shared, the existing slug + visibility are
 *  returned without minting a new slug — re-clicking "Share" gives
 *  the user the same URL so they don't fragment the share with
 *  multiple slugs. New shares default to `'public'` visibility.
 *
 *  Auth-gated. Owner-only via the existing `recipes_owner_all` RLS
 *  policy — a non-owner's UPDATE returns 0 rows and we 404 below. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing recipe id." }, { status: 400 });
  }

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return gate.response;

  // Check if already shared (idempotent path). RLS restricts the SELECT
  // to the caller's own recipes, so a missing row here means
  // not-owned-or-not-found.
  const { data: existing, error: getError } = await supabase
    .from("recipes")
    .select("id, share_slug, share_visibility")
    .eq("id", id)
    .maybeSingle();
  if (getError) {
    return NextResponse.json({ error: getError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Recipe not found." }, { status: 404 });
  }
  if (existing.share_slug) {
    return NextResponse.json({
      slug: existing.share_slug,
      visibility:
        (existing.share_visibility as ShareVisibility | null) ?? "public",
    });
  }

  // Mint a slug. The `share_slug` column is UNIQUE; on the (vanishingly
  // unlikely) collision the UPDATE returns a unique-violation and we
  // retry with a fresh slug. 5 attempts is generous — a real collision
  // means the alphabet space is exhausted, which won't happen at
  // realistic scale.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateShareSlug();
    const { data: updated, error: updateError } = await supabase
      .from("recipes")
      .update({ share_slug: slug, share_visibility: "public" })
      .eq("id", id)
      .select("share_slug, share_visibility")
      .maybeSingle();
    if (!updateError && updated?.share_slug) {
      return NextResponse.json({
        slug: updated.share_slug,
        visibility:
          (updated.share_visibility as ShareVisibility | null) ?? "public",
      });
    }
    // 23505 = unique_violation in Postgres. Anything else is fatal.
    if (updateError && updateError.code !== "23505") {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }
  return NextResponse.json(
    { error: "Failed to mint a unique share slug." },
    { status: 500 },
  );
}

/** Update the visibility of an existing share. Keeps `share_slug`
 *  untouched so the URL doesn't change — only who can resolve it. The
 *  three valid values:
 *    - `'public'`   — anon + authenticated can view
 *    - `'members'`  — authenticated only
 *    - `'disabled'` — slug persists but no one (except the owner) can view
 *
 *  Returns 404 when the recipe isn't shared yet (no slug). Owners
 *  should hit POST first to mint a slug, then PATCH to change
 *  visibility. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing recipe id." }, { status: 400 });
  }

  const parsed = await parseBody(req, PatchBodySchema);
  if (!parsed.ok) return parsed.response;
  const visibility: ShareVisibility = parsed.data.visibility;

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Refuse to set visibility on a row that isn't shared yet — the UI
  // shouldn't let this happen, but a 404 here is clearer than silently
  // storing a stranded visibility value.
  const { data: existing, error: getError } = await supabase
    .from("recipes")
    .select("id, share_slug")
    .eq("id", id)
    .maybeSingle();
  if (getError) {
    return NextResponse.json({ error: getError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Recipe not found." }, { status: 404 });
  }
  if (!existing.share_slug) {
    return NextResponse.json(
      { error: "Recipe isn't shared. Create a share link first." },
      { status: 409 },
    );
  }

  const { error: updateError } = await supabase
    .from("recipes")
    .update({ share_visibility: visibility })
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  return NextResponse.json({ visibility: visibility });
}

/** Revoke a recipe's share. Owner-only via RLS. The page at
 *  `/r/<slug>` will 404 immediately after this returns. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing recipe id." }, { status: 400 });
  }

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { error } = await supabase
    .from("recipes")
    .update({ share_slug: null })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
