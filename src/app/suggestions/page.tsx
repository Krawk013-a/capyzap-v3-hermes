"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";
import Avatar from "@/components/Avatar";
import type { Profile } from "@/types";

type Suggestion = {
  id: string;
  author_id: string;
  body: string;
  status: string;
  created_at: string;
  author?: Profile | null;
  votes_yes?: number;
  votes_no?: number;
  my_vote?: boolean | null;
};

/**
 * Tela de sugestões: qualquer usuário cadastra uma ideia e
 * todos votam sim/não (1 voto por pessoa). Ao vivo via Realtime.
 */
export default function SuggestionsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    const [meRes, list, votes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("suggestions")
        .select("*, author:profiles!suggestions_author_id_fkey(*)")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("suggestion_votes").select("suggestion_id, vote, user_id"),
    ]);
    setMe(meRes.data as Profile | null);

    const counts = new Map<string, { yes: number; no: number; mine: boolean | null }>();
    for (const v of votes.data ?? []) {
      const c = counts.get(v.suggestion_id) ?? { yes: 0, no: 0, mine: null };
      if (v.vote) c.yes += 1;
      else c.no += 1;
      if (v.user_id === user.id) c.mine = v.vote;
      counts.set(v.suggestion_id, c);
    }

    setItems(
      (list.data ?? []).map((s) => ({
        ...s,
        author: (s as { author?: Profile }).author ?? null,
        votes_yes: counts.get(s.id)?.yes ?? 0,
        votes_no: counts.get(s.id)?.no ?? 0,
        my_vote: counts.get(s.id)?.mine ?? null,
      })) as Suggestion[]
    );
    setLoading(false);
  }, [router]);

  useEffect(() => {
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    void load();

    (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      channel = supabase
        .channel("capy-suggestions")
        .on("postgres_changes", { event: "*", schema: "public", table: "suggestions" }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "suggestion_votes" }, () => void load())
        .subscribe();
    })();

    return () => {
      disposed = true;
      if (channel) getSupabaseBrowserClient().removeChannel(channel);
    };
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("no-user");
      const { error } = await supabase
        .from("suggestions")
        .insert({ author_id: user.id, body });
      if (error) throw error;
      setDraft("");
    } catch {
      setError("Não deu pra salvar a sugestão 🦫 tenta de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVote(id: string, vote: boolean) {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const current = items.find((i) => i.id === id)?.my_vote ?? null;
    if (current === vote) return; // já votou isso
    if (current === null) {
      await supabase
        .from("suggestion_votes")
        .insert({ suggestion_id: id, user_id: user.id, vote });
    } else {
      // troca o voto
      await supabase
        .from("suggestion_votes")
        .update({ vote })
        .eq("suggestion_id", id)
        .eq("user_id", user.id);
    }
    // realtime atualiza a tela
  }

  async function handleDelete(id: string) {
    const supabase = getSupabaseBrowserClient();
    await supabase.from("suggestions").delete().eq("id", id);
  }

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
        <h1 className="font-bold">Sugestões 💡</h1>
        <p className="ml-auto text-xs text-white/60">ideias de todo mundo, voto de cada um</p>
      </header>

      <div className="mx-auto w-full max-w-xl flex-1 p-4">
        {/* nova sugestão */}
        <form onSubmit={handleSubmit} className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-capy-fur/10">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-capy-dark/50">
            Sua ideia
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Ex.: poder mandar figurinha 🦫"
            className="capy-input resize-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-capy-dark/40">{draft.length}/500</span>
            <button type="submit" disabled={busy || !draft.trim()} className="capy-btn px-4 py-2 text-sm">
              {busy ? "Enviando…" : "Enviar sugestão"}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-capy-danger">{error}</p>}
        </form>

        {/* lista */}
        {loading ? (
          <p className="py-8 text-center text-sm text-capy-dark/50">Carregando…</p>
        ) : items.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-4xl">💡</p>
            <p className="mt-2 font-semibold text-capy-dark">Nenhuma sugestão ainda</p>
            <p className="text-sm text-capy-dark/50">Seja a primeira pessoa a propor algo!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((s) => {
              const mine = s.author_id === me?.id;
              return (
                <div key={s.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-capy-fur/10">
                  <div className="mb-2 flex items-center gap-2">
                    <Avatar profile={s.author ?? undefined} size={32} />
                    <span className="text-sm font-semibold text-capy-dark">
                      {s.author?.first_name ?? "Alguém"}
                    </span>
                    {mine && (
                      <button
                        onClick={() => void handleDelete(s.id)}
                        className="ml-auto text-xs text-capy-dark/40 hover:text-capy-danger"
                      >
                        apagar
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[15px] text-capy-dark">{s.body}</p>

                  {/* votos */}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => void handleVote(s.id, true)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold transition ${
                        s.my_vote === true
                          ? "bg-capy-green text-white"
                          : "bg-capy-green/10 text-capy-deep hover:bg-capy-green/20"
                      }`}
                    >
                      👍 {s.votes_yes ?? 0}
                    </button>
                    <button
                      onClick={() => void handleVote(s.id, false)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold transition ${
                        s.my_vote === false
                          ? "bg-capy-danger text-white"
                          : "bg-capy-danger/10 text-capy-danger hover:bg-capy-danger/20"
                      }`}
                    >
                      👎 {s.votes_no ?? 0}
                    </button>
                    <span className="ml-auto text-[11px] text-capy-dark/40">
                      {new Date(s.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
