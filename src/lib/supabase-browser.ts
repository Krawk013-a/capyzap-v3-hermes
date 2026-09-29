import { createBrowserClient } from "@supabase/ssr";

/**
 * Remove enter/espaço que "viajam" ao colar chaves (causa clássica de
 * "WebSocket failed" com %0A no fim da apikey).
 */
function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

export function getSupabaseBrowserClient() {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !key) {
    throw new Error(
      "CapyZap: configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local"
    );
  }
  return createBrowserClient(url, key);
}
