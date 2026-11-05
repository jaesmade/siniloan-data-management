"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseEnv } from "./env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  const { url, publishableKey } = getPublicSupabaseEnv();
  // A loopback Supabase URL belongs to the server PC, not a visitor's device.
  // Route browser requests through this app for local deployments.
  const localSupabase = (() => {
    try { return ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(new URL(url).hostname); }
    catch { return false; }
  })();
  const browserUrl = localSupabase && typeof window !== "undefined"
    ? `${window.location.origin}/supabase`
    : url;
  browserClient ??= createBrowserClient(browserUrl, publishableKey);
  return browserClient;
}
