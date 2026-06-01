import type { RecipeIngredient } from "@/components/macro/types";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { isValidShareSlug } from "@/lib/share-slug";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Import a shared recipe into the caller's own recipes. The shared
 *  row is read via the `recipes_public_read_shared` RLS policy (anon
 *  + authenticated can SELECT rows with share_slug != null) so the
 *  caller doesn't need any special permission beyond being signed in.
 *  We then INSERT a fresh row owned by the caller - new uuid, new
 *  timestamps, no share_slug - so the import is a true copy and the
 *  original owner is unaffected.
 *
 *  Idempotency: not enforced - clicking Import twice creates two
 *  copies. That's the same trade-off "Save as template" makes; users
 *  can delete duplicates from the Recipes view. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) {
    return NextResponse.json({ error: "Invalid share slug." }, { status: 400 });
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
    return NextResponse.json(
      { error: "Sign in to import a shared recipe." },
      { status: 401 },
    );
  }
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return gate.response;

  // Fetch the shared recipe. RLS allows this for any signed-in user.
  // We pull only the fields needed for the copy; user_id is excluded
  // by the SELECT to avoid leaking it into the response anywhere.
  const { data: shared, error: fetchError } = await supabase
    .from("recipes")
    .select("name, ingredients, cuisine, notes")
    .eq("share_slug", slug)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!shared) {
    return NextResponse.json(
      { error: "Shared recipe not found (it may have been unshared)." },
      { status: 404 },
    );
  }

  // Insert as a new recipe owned by the caller. crypto.randomUUID()
  // matches the IDB pattern (mintId), so once the sync engine pulls
  // this row down it'll land cleanly. share_slug is intentionally
  // omitted - imports start un-shared.
  const newId = crypto.randomUUID();
  const ingredients = shared.ingredients as RecipeIngredient[];
  const { data: inserted, error: insertError } = await supabase
    .from("recipes")
    .insert({
      id: newId,
      user_id: user.id,
      name: shared.name,
      ingredients,
      cuisine: shared.cuisine,
      notes: shared.notes,
    })
    .select("id, name")
    .single();
  if (insertError || !inserted) {
    return NextResponse.json(
      { error: insertError?.message ?? "Insert failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: inserted.id, name: inserted.name });
}
