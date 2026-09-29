"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // já logado? vai pro chat
    getSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (user) router.replace("/chat");
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.replace("/chat");
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("Invalid login")
          ? "E-mail ou senha incorretos 🦫"
          : "Não foi possível entrar. Confere o e-mail e tenta de novo."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-capy-sand to-capy-sanddark px-4 py-10">
      {/* logo capivara */}
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/capy.svg" alt="CapyZap" className="h-24 w-24 drop-shadow-lg" />
        <h1 className="text-3xl font-extrabold tracking-tight text-capy-dark">
          Capy<span className="text-capy-green">Zap</span>
        </h1>
        <p className="max-w-xs text-sm text-capy-dark/60">
          Mensagens rápidas com alma de capivara. Sem telefone, só e-mail. 🌿
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm animate-pop-in rounded-2xl bg-white p-6 shadow-xl ring-1 ring-capy-fur/10"
      >
        <h2 className="mb-4 text-lg font-bold text-capy-dark">Entrar</h2>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-capy-dark/50">
          E-mail
        </label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@exemplo.com"
          className="capy-input mb-4"
        />

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-capy-dark/50">
          Senha
        </label>
        <input
          type="password"
          required
          minLength={6}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="capy-input mb-5"
        />

        {error && (
          <p className="mb-4 rounded-lg bg-capy-danger/10 px-3 py-2 text-sm text-capy-danger">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="capy-btn w-full">
          {loading ? "Entrando…" : "Entrar"}
        </button>

        <p className="mt-4 text-center text-sm text-capy-dark/60">
          Não tem conta?{" "}
          <Link href="/signup" className="font-semibold text-capy-green hover:underline">
            Cadastre-se
          </Link>
        </p>
      </form>
    </main>
  );
}
