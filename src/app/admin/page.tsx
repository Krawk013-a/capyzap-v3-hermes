"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import Avatar from "@/components/Avatar";
import type { Profile } from "@/types";

type Row = Profile & { is_admin?: boolean };

/**
 * Painel admin — lista contas e permite "entrar como" um usuário
 * (modo suporte). Cada acesso é auditado no banco (admin_audit).
 */
export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<Row[]>([]);
  const [me, setMe] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    const { data: myProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    setMe(myProfile as Profile);
    if (!myProfile?.is_admin) {
      setBanner("Você não é admin 🦫 (is_admin = false no seu perfil)");
      setLoading(false);
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/admin-tools`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
          apikey: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "list" }),
      }
    );
    const json = (await res.json()) as { users?: Row[]; error?: string };
    if (json.error) setBanner("Erro: " + json.error);
    setUsers(json.users ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="flex min-h-dvh flex-col bg-capy-sand">
      <header className="flex items-center gap-3 bg-capy-dark px-3 py-2.5 text-white">
        <button
          onClick={() => router.push("/chat")}
          className="rounded-lg p-1.5 hover:bg-white/10"
          aria-label="Voltar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>
        <h1 className="font-bold">Painel Admin 🛡️</h1>
        {me && (
          <span className="ml-auto text-xs text-white/60">
            {me.first_name} {me.is_admin ? "⭐" : ""}
          </span>
        )}
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 p-4">
        <div className="mb-4 rounded-xl bg-capy-bubble/40 px-4 py-3 text-xs text-capy-deep">
          🔒 Painel apenas informativo. O CapyZap não acessa a conta de ninguém —
          conversas são privadas e este recurso de "entrar como" foi removido.
        </div>
        {banner && (
          <div className="mb-4 rounded-xl bg-capy-danger/10 px-4 py-3 text-sm text-capy-danger">
            {banner}
          </div>
        )}
        {loading ? (
          <p className="py-8 text-center text-sm text-capy-dark/50">Carregando contas…</p>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-capy-fur/10"
              >
                <Avatar profile={u} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-capy-dark">
                    {u.first_name} {u.last_name} {u.is_admin ? "⭐" : ""}
                  </p>
                  <p className="truncate text-xs text-capy-dark/50">{u.email}</p>
                  <p className="text-[10px] text-capy-dark/35">
                    {u.last_seen_at
                      ? `visto: ${new Date(u.last_seen_at).toLocaleString("pt-BR")}`
                      : "nunca visto"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
                    u.is_admin ? "bg-capy-fur/15 text-capy-dark/40" : "bg-capy-green/10 text-capy-deep"
                  }`}
                >
                  {u.is_admin ? "admin ⭐" : "usuário"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
