import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const supabaseOrigin = (() => {
  try { return new URL(supabaseUrl).origin; }
  catch { return "http://127.0.0.1:54321"; }
})();
const localSupabase = ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(new URL(supabaseOrigin).hostname);
const supabaseSocketOrigin = supabaseOrigin.replace(/^http/, "ws");
const localSupabaseOrigins = "http://127.0.0.1:54321 http://localhost:54321 ws://127.0.0.1:54321 ws://localhost:54321";
const scriptPolicy = process.env.NODE_ENV === "development" ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";
const transportPolicy = process.env.NODE_ENV === "production" && !localSupabase ? "; upgrade-insecure-requests" : "";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: { optimizePackageImports: ["@phosphor-icons/react"] },
  allowedDevOrigins: ["192.168.68.105", "192.168.1.101"],
  poweredByHeader: false,
  async rewrites() {
    if (!localSupabase) return [];
    return [{ source: "/supabase/:path*", destination: `${supabaseOrigin}/:path*` }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; ${scriptPolicy}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ${localSupabaseOrigins} ${supabaseOrigin} ${supabaseSocketOrigin}${transportPolicy}` },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default nextConfig;
