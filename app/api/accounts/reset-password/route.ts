import { randomBytes } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { checkRateLimit, isSameOrigin, rateLimitHeaders, requestFingerprint } from "@/lib/security/request-security";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers: noStore });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error: "Content-Type must be application/json." }, { status: 415, headers: noStore });
  if (Number(request.headers.get("content-length") ?? 0) > 4_096) return Response.json({ error: "Request body is too large." }, { status: 413, headers: noStore });

  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return Response.json({ error: "Sign in with an administrator account to reset passwords." }, { status: 401, headers: noStore });

  let body: { userId?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request body." }, { status: 400, headers: noStore }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid request body." }, { status: 400, headers: noStore });
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!uuidPattern.test(userId)) return Response.json({ error: "Choose a valid account." }, { status: 400, headers: noStore });

  const { url, publishableKey } = getPublicSupabaseEnv();
  const authClient = createSupabaseClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return Response.json({ error: "Your session expired. Sign in again." }, { status: 401, headers: noStore });

  const admin = createAdminClient();
  const { data: actor, error: actorError } = await admin.schema("core").from("profiles").select("id, role, status").eq("id", authData.user.id).maybeSingle();
  if (actorError || !actor || !(actor.role === "dpo" || actor.role === "system_admin") || actor.status !== "active") return Response.json({ error: "Only an active DPO or System Administrator can reset account passwords." }, { status: 403, headers: noStore });

  const rateLimit = await checkRateLimit("accounts.password_reset", requestFingerprint(request, actor.id), 10, 60 * 60);
  if (!rateLimit.allowed) return Response.json({ error: "Too many password resets. Try again later." }, { status: 429, headers: { ...rateLimitHeaders(rateLimit, 10), ...noStore } });

  const { data: target, error: targetError } = await admin.schema("core").from("profiles").select("id, full_name, username, role, status").eq("id", userId).maybeSingle();
  if (targetError || !target || target.status !== "active" || target.role === "system_admin" || (actor.role === "dpo" && target.role === "dpo")) return Response.json({ error: "Choose an active account you are allowed to manage." }, { status: 404, headers: noStore });

  const generatedPassword = randomBytes(24).toString("base64url");
  const { error: passwordError } = await admin.auth.admin.updateUserById(target.id, { password: generatedPassword });
  if (passwordError) return Response.json({ error: "The password could not be reset." }, { status: 500, headers: noStore });

  await admin.schema("core").from("audit_events").insert({
    source: "application",
    actor_id: actor.id,
    action: "auth.password_reset_admin",
    outcome: "success",
    target_type: "profile",
    target_id: target.id,
    summary: `Administrator generated a new password for ${target.full_name}`,
    metadata: { username: target.username },
  });

  return Response.json({ password: generatedPassword }, { headers: noStore });
}
