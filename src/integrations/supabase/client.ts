import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const GESTAO_HOSTS = new Set([
  "api.ahrbrasil.com.br",
  "jpporhfdwgpgdfbpnckg.supabase.co",
  "nhtxyxdntigfgmfhubpe.supabase.co",
]);

function criar(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)?.trim();
  if (!url || !key) return null;
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  if (GESTAO_HOSTS.has(host)) {
    throw new Error("Este ERP não usa o banco do Gestão.");
  }
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "ahr-erp-auth",
    },
  });
}

export const supabase = criar();
export const supabaseConfigurado = supabase != null;
