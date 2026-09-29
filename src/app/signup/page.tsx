"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function SignupPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await getSupabaseBrowserClient().auth.signUp({
        email,
        password,
        options: {
          data: { first_name: firstName.trim(), last_name: lastName.trim() },
        },
      });
      if (error) throw error;

      if (data.session) {
        // confirmação de e-mail desligada → já entra
        router.replace("/chat");
      } else {
        // confirmação ligada → avisa
        setError("almost");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.includes("already registered")
          ? "Esse e-mail já tem conta. Faz login 😉"
          : "Não foi possível criar a conta. Tenta de novo."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-capy-sand to-capy-sanddark px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/capy.svg" alt="CapyZap" className="h-16 w-16" />
        <h1 className="text-2xl font-extrabold text-capy-dark">
          Criar conta no Capy<span className="text-capy-green">Zap</span>
        </h1>
        <p className="text-sm text-capy-dark/60">Só e-mail e senha. Nada de telefone. 🌿</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm animate-pop-in rounded-2xl bg-white p-6 shadow-xl ring-1 ring-capy-fur/10"
      >
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-capy-dark/50">
              Nome
            </label>
            <input
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Maria"
              className="capy-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-capy-dark/50">
              Sobrenome
            </label>
            <input
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Silva"
              className="capy-input"
            />
          </div>
        </div>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-capy-dark/50">
          E-mail
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@exemplo.com"
          className="capy-input mb-4"
        />

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-capy-dark/50">
          Senha (mínimo 6)
        </label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="capy-input mb-5"
        />

        {error === "almost" ? (
          <p className="mb-4 rounded-lg bg-capy-green/10 px-3 py-2 text-sm text-capy-deep">
            Conta criada! Confirma teu e-mail (caixa de entrada ou spam) e volta pra fazer
            login. 📬
          </p>
        ) : error ? (
          <p className="mb-4 rounded-lg bg-capy-danger/10 px-3 py-2 text-sm text-capy-danger">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={loading} className="capy-btn w-full">
          {loading ? "Criando…" : "Criar conta"}
        </button>

        <p className="mt-4 text-center text-sm text-capy-dark/60">
          Já tem conta?{" "}
          <Link href="/login" className="font-semibold text-capy-green hover:underline">
            Entrar
          </Link>
        </p>
      </form>
    </main>
  );
}
