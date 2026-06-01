import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { createClient } from "@supabase/supabase-js";
import { CapturePhoneClient } from "./CapturePhoneClient";

type Props = { params: Promise<{ id: string }> };

type SessionResult =
  | { kind: "ok"; uploadUrl: string; expiresAt: string }
  | { kind: "error"; title: string; body: string };

/** Validate the session + mint the signed upload URL. Extracted from
 *  the component so the impure clock read (Date.now) stays out of the
 *  render path — `react-hooks/purity` is strict about this for
 *  components, but a plain async helper is fine. */
async function loadSession(id: string): Promise<SessionResult> {
  const secret = getSupabaseSecretConfig();
  if (!secret) {
    return {
      kind: "error",
      title: "Pairing isn't configured",
      body: "The deployment is missing SUPABASE_SECRET_KEY. The laptop user should reach out to the maintainer.",
    };
  }
  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: row } = await admin
    .from("captures")
    .select("user_id, expires_at, kind")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return {
      kind: "error",
      title: "Pairing session not found",
      body: "The link may have expired or been generated for a different deployment. Refresh the QR on your laptop and scan again.",
    };
  }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return {
      kind: "error",
      title: "Pairing session expired",
      body: "Sessions last 5 minutes. Click 'Pair my phone' on the laptop again and scan the new QR.",
    };
  }
  if (row.kind) {
    return {
      kind: "error",
      title: "Already paired",
      body: "This session has already received a capture. Refresh the QR on your laptop to start a new one.",
    };
  }

  const photoPath = `${row.user_id as string}/${id}.jpg`;
  const { data: signed, error: signError } = await admin.storage
    .from("captures")
    .createSignedUploadUrl(photoPath);
  if (signError || !signed) {
    return {
      kind: "error",
      title: "Couldn't prepare the upload URL",
      body: signError?.message ?? "Try refreshing the QR on your laptop.",
    };
  }
  return {
    kind: "ok",
    uploadUrl: signed.signedUrl,
    expiresAt: row.expires_at as string,
  };
}

/** Phone-facing landing page. The laptop puts `https://app.url/capture/<id>`
 *  in a QR; the user scans it with their phone's native camera, which
 *  opens this page in the system browser. We pre-validate the session
 *  + mint a fresh signed upload URL server-side using the service-role
 *  client (the phone is unauthenticated — knowing the session id is
 *  the only credential).
 *
 *  Refreshing the page re-runs this server render, which mints a fresh
 *  signed URL — recovering gracefully from any "URL expired" hiccup. */
export default async function CapturePhonePage({ params }: Props) {
  const { id } = await params;
  const session = await loadSession(id);
  if (session.kind === "error") {
    return (
      <ExpiredScreen
        title={session.title}
        body={session.body}
      />
    );
  }
  return (
    <CapturePhoneClient
      sessionId={id}
      uploadUrl={session.uploadUrl}
      expiresAt={session.expiresAt}
    />
  );
}

function ExpiredScreen({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-base font-semibold tracking-tight">{title}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
