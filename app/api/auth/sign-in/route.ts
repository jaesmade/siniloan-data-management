import { createClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { checkRateLimit, isSameOrigin, rateLimitHeaders, requestFingerprint } from "@/lib/security/request-security";

export const runtime = "nodejs";

const invalidCredentials = () =>
  Response.json(
    { error: "We could not sign you in. Check your username and password." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8_192) return Response.json({ error: "Request body is too large." }, { status: 413 });

  let credentials: { username?: unknown; password?: unknown };
  try {
    credentials = await request.json();
  } catch {
    return invalidCredentials();
  }
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return invalidCredentials();

  const username = typeof credentials.username === "string" ? credentials.username.trim() : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username) || !password || password.length > 256) return invalidCredentials();

  const rateLimit = await checkRateLimit("auth.sign_in", requestFingerprint(request, username), 5, 15 * 60);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: rateLimitHeaders(rateLimit, 5) },
    );
  }

  const admin = createAdminClient();
  const { data: profile, error: lookupError } = await admin
    .schema("core")
    .from("profiles")
    .select("id, email")
    .ilike("username", username)
    .maybeSingle();
  if (lookupError || !profile?.email) {
    await admin.schema("core").rpc("record_auth_event", { event_actor_id: null, attempted_username: username, event_outcome: "failure" });
    return invalidCredentials();
  }

  const { url, publishableKey } = getPublicSupabaseEnv();
  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password,
  });
  if (error || !data.session) {
    await admin.schema("core").rpc("record_auth_event", { event_actor_id: profile.id, attempted_username: username, event_outcome: "failure" });
    return invalidCredentials();
  }

  await admin.schema("core").rpc("record_auth_event", { event_actor_id: profile.id, attempted_username: username, event_outcome: "success" });

  return Response.json(
    {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    },
    { headers: { "Cache-Control": "no-store", "X-RateLimit-Limit": "5", "X-RateLimit-Remaining": String(rateLimit.remaining) } },
  );
}
